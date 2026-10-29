package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"

	"mitbringsel/internal/auth"
	"mitbringsel/internal/config"
)

const (
	// The __Host- prefix makes the browser accept the cookie only with
	// Secure, Path=/ and no Domain. Other services on sibling subdomains of
	// the same parent domain therefore cannot set or overwrite it.
	sessionCookieSecure = "__Host-session"
	// Local development runs on plain http://localhost, where Safari rejects
	// Secure cookies and with them the __Host- prefix.
	sessionCookieDev = "session"
)

// SessionValidator resolves a session token to the user it belongs to.
// *auth.SessionService satisfies it; tests use a fake.
type SessionValidator interface {
	Validate(ctx context.Context, token string) (uuid.UUID, error)
}

// SessionManager adds creating and deleting sessions for the login and
// logout handlers. requireUser keeps asking only for SessionValidator.
type SessionManager interface {
	SessionValidator
	Create(ctx context.Context, userID uuid.UUID) (token string, expiresAt time.Time, err error)
	Delete(ctx context.Context, token string) error
}

// userIDKey is unexported, so no other package can create the same key and
// read or overwrite the value by accident.
type userIDKey struct{}

func sessionCookieName(env config.Env) string {
	if env == config.EnvDevelopment {
		return sessionCookieDev
	}
	return sessionCookieSecure
}

// setSessionCookie hands the session token to the browser.
func setSessionCookie(w http.ResponseWriter, env config.Env, token string, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:    sessionCookieName(env),
		Value:   token,
		Path:    "/",
		Expires: expiresAt,
		// JavaScript cannot read the cookie, so an XSS bug cannot steal it.
		HttpOnly: true,
		// Required by the __Host- prefix; local development has no HTTPS.
		Secure: env != config.EnvDevelopment,
		// The browser leaves the cookie off requests other sites trigger,
		// except plain top-level navigation such as following a link.
		SameSite: http.SameSiteLaxMode,
	})
}

// clearSessionCookie tells the browser to drop the session cookie. The
// attributes must match setSessionCookie, otherwise the browser treats it
// as a different cookie and keeps the old one.
func clearSessionCookie(w http.ResponseWriter, env config.Env) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName(env),
		Path:     "/",
		MaxAge:   -1, // sent as Max-Age=0: expire now
		HttpOnly: true,
		Secure:   env != config.EnvDevelopment,
		SameSite: http.SameSiteLaxMode,
	})
}

// requireUser wraps handlers that need a logged-in user. It answers 401
// itself, so the wrapped handler only runs with a valid session and can
// read the user ID with userIDFrom.
func requireUser(sessions SessionValidator, cookieName string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			// r.Cookie only fails with http.ErrNoCookie.
			cookie, err := r.Cookie(cookieName)
			if err != nil {
				writeError(w, http.StatusUnauthorized, CodeUnauthenticated)
				return
			}

			userID, err := sessions.Validate(r.Context(), cookie.Value)
			if errors.Is(err, auth.ErrSessionNotFound) {
				writeError(w, http.StatusUnauthorized, CodeUnauthenticated)
				return
			}
			if err != nil {
				// Not 401: the frontend would log the user out because the
				// database is briefly unreachable.
				slog.Error("validate session", "error", err)
				writeError(w, http.StatusInternalServerError, CodeInternal)
				return
			}

			ctx := context.WithValue(r.Context(), userIDKey{}, userID)
			next(w, r.WithContext(ctx))
		}
	}
}

// userIDFrom returns the user set by requireUser. ok is false if the
// handler was registered without requireUser, which is a programming error.
func userIDFrom(ctx context.Context) (userID uuid.UUID, ok bool) {
	userID, ok = ctx.Value(userIDKey{}).(uuid.UUID)
	return userID, ok
}
