package httpapi

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"mitbringsel/internal/auth"
	"mitbringsel/internal/config"
	"mitbringsel/internal/user"
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
	// Separates the three values in the cookie. None of them contains it:
	// state and nonce are base32, the verifier is base64url.
	loginAttemptSeparator = "."

	// Where the callback sends the browser. Relative, so it stays on the
	// host Google redirected back to.
	appHomePath   = "/"
	loginPagePath = "/login"
	// Values of /login?error=... (docs/auth.md). Google's own code for
	// "the user cancelled" is passed on; everything else is login_failed.
	loginErrorCancelled = "access_denied"
	loginErrorFailed    = "login_failed"
)

// GoogleLogin is what the handlers need from the Google provider.
// *auth.GoogleProvider satisfies it; tests use a fake.
type GoogleLogin interface {
	AuthCodeURL(attempt auth.LoginAttempt) string
	Exchange(ctx context.Context, code string, attempt auth.LoginAttempt) (user.Identity, error)
}

// googleLoginHandler starts a login: it remembers a fresh login attempt in
// a cookie and sends the browser to Google.
func googleLoginHandler(google GoogleLogin, env config.Env) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		attempt := auth.NewLoginAttempt()
		setLoginAttemptCookie(w, env, attempt)
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
		attempt, attemptErr := readLoginAttempt(r, env)
		clearLoginAttemptCookie(w, env)

		fail := func(code string) {
			http.Redirect(w, r, loginPagePath+"?error="+url.QueryEscape(code), http.StatusFound)
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
		http.Redirect(w, r, appHomePath, http.StatusFound)
	}
}

func loginAttemptCookieName(env config.Env) string {
	if env == config.EnvDevelopment {
		return loginAttemptCookieDev
	}
	return loginAttemptCookieSecure
}

// setLoginAttemptCookie stores the attempt in the browser. The values are
// worthless to anyone else: the verifier only works with a code issued for
// this attempt, and the cookie is HttpOnly and only sent to the callback.
func setLoginAttemptCookie(w http.ResponseWriter, env config.Env, attempt auth.LoginAttempt) {
	http.SetCookie(w, &http.Cookie{
		Name:     loginAttemptCookieName(env),
		Value:    strings.Join([]string{attempt.State, attempt.Nonce, attempt.Verifier}, loginAttemptSeparator),
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

func readLoginAttempt(r *http.Request, env config.Env) (auth.LoginAttempt, error) {
	cookie, err := r.Cookie(loginAttemptCookieName(env))
	if err != nil {
		return auth.LoginAttempt{}, err
	}
	parts := strings.Split(cookie.Value, loginAttemptSeparator)
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return auth.LoginAttempt{}, errors.New("malformed login attempt cookie")
	}
	return auth.LoginAttempt{State: parts[0], Nonce: parts[1], Verifier: parts[2]}, nil
}
