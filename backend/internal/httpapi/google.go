package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"tuolino/internal/auth"
	"tuolino/internal/config"
	"tuolino/internal/user"
)

const (
	googleLoginPath = "/api/v1/auth/google/login"
	// GoogleCallbackPath is where Google sends the browser back to. main
	// builds the redirect URL registered at Google from it.
	GoogleCallbackPath = "/api/v1/auth/google/callback"

	// The __Secure- prefix makes the browser accept the cookie only with
	// Secure. Unlike __Host- it allows a narrow Path, so the cookie only
	// travels with the callback request.
	loginAttemptCookieSecure = "__Secure-google-login"
	// Local development runs on plain http://localhost (see sessionCookieDev).
	loginAttemptCookieDev = "google-login"
	// Long enough to pick an account and type a password, short enough that
	// a forgotten tab does not keep a usable attempt around.
	loginAttemptMaxAge = 10 * time.Minute
	// Separates the values in the cookie. None of them contains it: state and
	// nonce are base32, the verifier and the return path (see
	// encodeNextPath) are base64url.
	loginAttemptSeparator = "."

	// Where the callback sends the browser. Relative, so it stays on the
	// host Google redirected back to.
	appHomePath   = "/"
	loginPagePath = "/login"
	// Values of /login?error=... (docs/auth.md). Google's own code for
	// "the user cancelled" is passed on; everything else is login_failed.
	loginErrorCancelled   = "access_denied"
	loginErrorFailed      = "login_failed"
	loginErrorRateLimited = "rate_limited"
)

// GoogleLogin is what the handlers need from the Google provider.
// *auth.GoogleProvider satisfies it; tests use a fake.
type GoogleLogin interface {
	AuthCodeURL(attempt auth.LoginAttempt) string
	Exchange(ctx context.Context, code string, attempt auth.LoginAttempt) (user.Identity, error)
}

// googleLoginHandler starts a login: it remembers a fresh login attempt in
// a cookie and sends the browser to Google. The optional query parameter
// "next" is the page to return to after the login; it is kept in the same
// cookie, and ignored unless it is a safe path inside the app.
func googleLoginHandler(google GoogleLogin, env config.Env) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		attempt := auth.NewLoginAttempt()
		setLoginAttemptCookie(w, env, attempt, safeNextPath(r.URL.Query().Get(nextParam)))
		// Every click must start a new attempt; a cached redirect would
		// reuse old values that no longer match the cookie.
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, google.AuthCodeURL(attempt), http.StatusFound)
	}
}

// googleCallbackHandler finishes a login. It answers with redirects, not
// JSON: the browser arrives here by navigation, so the user should end up
// on a page, either the app or the login page with an error.
func googleCallbackHandler(google GoogleLogin, users UserService, sessions SessionManager, env config.Env) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Read, then cleared on every outcome: an attempt is good for one
		// try only.
		attempt, next, attemptErr := readLoginAttempt(r, env)
		clearLoginAttemptCookie(w, env)

		// The login page gets the return path back, so "Try again" there
		// still leads to the page the user came from.
		fail := func(code string) {
			http.Redirect(w, r, loginErrorURL(code, next), http.StatusFound)
		}

		query := r.URL.Query()
		if googleErr := query.Get("error"); googleErr != "" {
			if googleErr == loginErrorCancelled {
				fail(loginErrorCancelled)
				return
			}
			slog.Warn("google login: google returned an error", "error", googleErr)
			fail(loginErrorFailed)
			return
		}

		// Typical causes: the attempt expired, or the callback URL was
		// opened without starting at the login endpoint.
		if attemptErr != nil {
			slog.Warn("google login: no valid login attempt", "error", attemptErr)
			fail(loginErrorFailed)
			return
		}
		// ConstantTimeCompare takes as long for a near miss as for a total
		// miss, so response times reveal nothing about the expected state.
		if subtle.ConstantTimeCompare([]byte(query.Get("state")), []byte(attempt.State)) != 1 {
			slog.Warn("google login: state does not match")
			fail(loginErrorFailed)
			return
		}
		code := query.Get("code")
		if code == "" {
			slog.Warn("google login: no code in callback")
			fail(loginErrorFailed)
			return
		}

		identity, err := google.Exchange(r.Context(), code, attempt)
		if errors.Is(err, auth.ErrEmailNotVerified) {
			slog.Warn("google login: email not verified")
			fail(loginErrorFailed)
			return
		}
		if err != nil {
			slog.Error("google login: exchange code", "error", err)
			fail(loginErrorFailed)
			return
		}

		u, err := users.SignIn(r.Context(), identity)
		if err != nil {
			slog.Error("google login: sign in", "error", err)
			fail(loginErrorFailed)
			return
		}

		token, expiresAt, err := sessions.Create(r.Context(), u.ID)
		if err != nil {
			slog.Error("google login: create session", "error", err)
			fail(loginErrorFailed)
			return
		}

		setSessionCookie(w, env, token, expiresAt)
		target := appHomePath
		if next != "" {
			target = next
		}
		http.Redirect(w, r, target, http.StatusFound)
	}
}

func loginAttemptCookieName(env config.Env) string {
	if env == config.EnvDevelopment {
		return loginAttemptCookieDev
	}
	return loginAttemptCookieSecure
}

// loginErrorURL is the login page with the reason it is shown. next, if
// there is one, is passed on so the login can go back to where it started.
func loginErrorURL(code, next string) string {
	target := loginPagePath + "?error=" + url.QueryEscape(code)
	if next != "" {
		target += "&" + nextParam + "=" + url.QueryEscape(next)
	}
	return target
}

// setLoginAttemptCookie stores the attempt in the browser. The values are
// worthless to anyone else: the verifier only works with a code issued for
// this attempt, and the cookie is HttpOnly and only sent to the callback.
// next (empty if none) is the already checked path to return to.
func setLoginAttemptCookie(w http.ResponseWriter, env config.Env, attempt auth.LoginAttempt, next string) {
	values := []string{attempt.State, attempt.Nonce, attempt.Verifier}
	if next != "" {
		values = append(values, base64.RawURLEncoding.EncodeToString([]byte(next)))
	}
	http.SetCookie(w, &http.Cookie{
		Name:     loginAttemptCookieName(env),
		Value:    strings.Join(values, loginAttemptSeparator),
		Path:     GoogleCallbackPath,
		MaxAge:   int(loginAttemptMaxAge.Seconds()),
		HttpOnly: true,
		Secure:   env != config.EnvDevelopment,
		// Lax still sends the cookie when Google navigates the browser back
		// here (a top-level GET), but not with requests other sites make in
		// the background.
		SameSite: http.SameSiteLaxMode,
	})
}

// clearLoginAttemptCookie must use the same attributes as
// setLoginAttemptCookie, otherwise the browser keeps the old cookie.
func clearLoginAttemptCookie(w http.ResponseWriter, env config.Env) {
	http.SetCookie(w, &http.Cookie{
		Name:     loginAttemptCookieName(env),
		Path:     GoogleCallbackPath,
		MaxAge:   -1, // sent as Max-Age=0: expire now
		HttpOnly: true,
		Secure:   env != config.EnvDevelopment,
		SameSite: http.SameSiteLaxMode,
	})
}

// readLoginAttempt returns the attempt and the path to return to ("" if the
// login started without one). A damaged or unsafe return path is dropped
// instead of failing the login: the user signs in and lands on the start
// page. The cookie is checked again here because the browser can send
// anything in it.
func readLoginAttempt(r *http.Request, env config.Env) (attempt auth.LoginAttempt, next string, err error) {
	cookie, err := r.Cookie(loginAttemptCookieName(env))
	if err != nil {
		return auth.LoginAttempt{}, "", err
	}
	parts := strings.Split(cookie.Value, loginAttemptSeparator)
	if len(parts) < 3 || len(parts) > 4 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return auth.LoginAttempt{}, "", errors.New("malformed login attempt cookie")
	}
	if len(parts) == 4 {
		if decoded, decodeErr := base64.RawURLEncoding.DecodeString(parts[3]); decodeErr == nil {
			next = safeNextPath(string(decoded))
		}
	}
	return auth.LoginAttempt{State: parts[0], Nonce: parts[1], Verifier: parts[2]}, next, nil
}
