package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"mitbringsel/internal/auth"
	"mitbringsel/internal/config"
	"mitbringsel/internal/user"
)

const fakeGoogleAuthURL = "https://accounts.example.com/auth"

var googleIdentity = user.Identity{Subject: "1234567890", Email: "anna@example.com", Name: "Anna"}

// fakeGoogle hands out a URL that carries the state, and returns a fixed
// identity or error from Exchange.
type fakeGoogle struct {
	exchangeErr  error
	gotCode      string
	gotAttempt   auth.LoginAttempt
	exchangeRuns int
}

func (f *fakeGoogle) AuthCodeURL(attempt auth.LoginAttempt) string {
	return fakeGoogleAuthURL + "?state=" + url.QueryEscape(attempt.State)
}

func (f *fakeGoogle) Exchange(_ context.Context, code string, attempt auth.LoginAttempt) (user.Identity, error) {
	f.exchangeRuns++
	f.gotCode = code
	f.gotAttempt = attempt
	if f.exchangeErr != nil {
		return user.Identity{}, f.exchangeErr
	}
	return googleIdentity, nil
}

func newGoogleRouter(env config.Env, google *fakeGoogle, sessions *fakeSessions, users *fakeUsers) http.Handler {
	return NewRouter(Deps{Env: env, DB: fakePinger{}, Sessions: sessions, Users: users, Google: google})
}

func TestGoogleLogin(t *testing.T) {
	tests := []struct {
		name       string
		env        config.Env
		wantCookie string
		wantSecure bool
	}{
		{name: "development", env: config.EnvDevelopment, wantCookie: "google-login"},
		{name: "production", env: config.EnvProduction, wantCookie: "__Secure-google-login", wantSecure: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, googleLoginPath, nil)

			newGoogleRouter(tt.env, &fakeGoogle{}, &fakeSessions{}, &fakeUsers{}).ServeHTTP(rec, req)

			if rec.Code != http.StatusFound {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
			}
			cookie := findCookie(rec, tt.wantCookie)
			if cookie == nil {
				t.Fatalf("no %s cookie set", tt.wantCookie)
			}
			if cookie.Path != GoogleCallbackPath || !cookie.HttpOnly || cookie.Secure != tt.wantSecure ||
				cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge <= 0 {
				t.Errorf("cookie attributes = %+v", cookie)
			}

			// The state in the redirect is the one remembered in the cookie.
			state, _, _ := strings.Cut(cookie.Value, loginAttemptSeparator)
			wantLocation := fakeGoogleAuthURL + "?state=" + url.QueryEscape(state)
			if got := rec.Header().Get("Location"); got != wantLocation {
				t.Errorf("Location = %q, want %q", got, wantLocation)
			}
			if got := rec.Header().Get("Cache-Control"); got != "no-store" {
				t.Errorf("Cache-Control = %q, want no-store", got)
			}
		})
	}
}

func TestGoogleCallback(t *testing.T) {
	attempt := auth.LoginAttempt{State: "STATE", Nonce: "NONCE", Verifier: "VERIFIER"}
	attemptCookie := &http.Cookie{
		Name:  loginAttemptCookieDev,
		Value: strings.Join([]string{attempt.State, attempt.Nonce, attempt.Verifier}, loginAttemptSeparator),
	}
	okQuery := "?state=STATE&code=CODE"

	tests := []struct {
		name         string
		query        string
		cookie       *http.Cookie
		exchangeErr  error
		usersErr     error
		createErr    error
		wantLocation string
		wantExchange bool
	}{
		{
			name:         "success",
			query:        okQuery,
			cookie:       attemptCookie,
			wantLocation: "/",
			wantExchange: true,
		},
		{
			name:         "user cancelled at google",
			query:        "?error=access_denied&state=STATE",
			cookie:       attemptCookie,
			wantLocation: "/login?error=access_denied",
		},
		{
			name:         "other error from google",
			query:        "?error=server_error&state=STATE",
			cookie:       attemptCookie,
			wantLocation: "/login?error=login_failed",
		},
		{
			name:         "no login attempt cookie",
			query:        okQuery,
			wantLocation: "/login?error=login_failed",
		},
		{
			name:         "malformed login attempt cookie",
			query:        okQuery,
			cookie:       &http.Cookie{Name: loginAttemptCookieDev, Value: "STATE.NONCE"},
			wantLocation: "/login?error=login_failed",
		},
		{
			name:         "state does not match",
			query:        "?state=OTHER&code=CODE",
			cookie:       attemptCookie,
			wantLocation: "/login?error=login_failed",
		},
		{
			name:         "missing code",
			query:        "?state=STATE",
			cookie:       attemptCookie,
			wantLocation: "/login?error=login_failed",
		},
		{
			name:         "exchange fails",
			query:        okQuery,
			cookie:       attemptCookie,
			exchangeErr:  errors.New("invalid_grant"),
			wantLocation: "/login?error=login_failed",
			wantExchange: true,
		},
		{
			name:         "email not verified",
			query:        okQuery,
			cookie:       attemptCookie,
			exchangeErr:  auth.ErrEmailNotVerified,
			wantLocation: "/login?error=login_failed",
			wantExchange: true,
		},
		{
			name:         "sign in fails",
			query:        okQuery,
			cookie:       attemptCookie,
			usersErr:     errors.New("connection refused"),
			wantLocation: "/login?error=login_failed",
			wantExchange: true,
		},
		{
			name:         "session creation fails",
			query:        okQuery,
			cookie:       attemptCookie,
			createErr:    errors.New("connection refused"),
			wantLocation: "/login?error=login_failed",
			wantExchange: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			google := &fakeGoogle{exchangeErr: tt.exchangeErr}
			sessions := &fakeSessions{createErr: tt.createErr}
			users := &fakeUsers{err: tt.usersErr}
			req := httptest.NewRequest(http.MethodGet, GoogleCallbackPath+tt.query, nil)
			if tt.cookie != nil {
				req.AddCookie(tt.cookie)
			}
			rec := httptest.NewRecorder()

			newGoogleRouter(config.EnvDevelopment, google, sessions, users).ServeHTTP(rec, req)

			if rec.Code != http.StatusFound {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
			}
			if got := rec.Header().Get("Location"); got != tt.wantLocation {
				t.Errorf("Location = %q, want %q", got, tt.wantLocation)
			}

			// The attempt is single use, whatever the outcome.
			if cleared := findCookie(rec, loginAttemptCookieDev); cleared == nil || cleared.MaxAge >= 0 {
				t.Errorf("login attempt cookie not cleared, got %v", cleared)
			}

			if (google.exchangeRuns == 1) != tt.wantExchange {
				t.Fatalf("Exchange ran %d times, want run = %v", google.exchangeRuns, tt.wantExchange)
			}
			if tt.wantExchange && (google.gotCode != "CODE" || google.gotAttempt != attempt) {
				t.Errorf("Exchange(%q, %+v), want code CODE and %+v", google.gotCode, google.gotAttempt, attempt)
			}

			session := findCookie(rec, sessionCookieName(config.EnvDevelopment))
			if tt.wantLocation != appHomePath {
				if session != nil {
					t.Errorf("failed login set a session cookie: %v", session)
				}
				return
			}
			if session == nil || session.Value != newToken {
				t.Errorf("session cookie = %v, want token %q", session, newToken)
			}
			if len(users.signIns) != 1 || users.signIns[0] != googleIdentity {
				t.Errorf("SignIn called with %+v, want %+v", users.signIns, googleIdentity)
			}
		})
	}
}

func TestGoogleRoutesNeedConfiguration(t *testing.T) {
	// Deps.Google left nil: the Google login is not configured.
	router := newAuthRouter(config.EnvDevelopment, &fakeSessions{}, &fakeUsers{})

	for _, path := range []string{googleLoginPath, GoogleCallbackPath} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("GET %s status = %d, want %d", path, rec.Code, http.StatusNotFound)
		}
	}
}
