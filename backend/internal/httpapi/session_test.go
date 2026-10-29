package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"mitbringsel/internal/auth"
	"mitbringsel/internal/config"
)

// testEnv is the environment the requireUser tests run in; testCookieName
// is the cookie name that goes with it.
const testEnv = config.EnvDevelopment

var testCookieName = sessionCookieName(testEnv)

var testUserID = uuid.MustParse("0190a8c4-0000-7000-8000-000000000001")

// fakeValidator accepts exactly one token and records what it was asked.
type fakeValidator struct {
	validToken string
	// err, if set, is returned for every token.
	err error
	// renewedUntil is returned for the valid token, as if the session had
	// just been renewed. Zero means no renewal.
	renewedUntil time.Time
	gotTokens    []string
}

func (f *fakeValidator) Validate(_ context.Context, token string) (uuid.UUID, time.Time, error) {
	f.gotTokens = append(f.gotTokens, token)
	if f.err != nil {
		return uuid.Nil, time.Time{}, f.err
	}
	if token != f.validToken {
		return uuid.Nil, time.Time{}, auth.ErrSessionNotFound
	}
	return testUserID, f.renewedUntil, nil
}

func TestRequireUser(t *testing.T) {
	const validToken = "VALID-TOKEN"

	tests := []struct {
		name         string
		cookie       *http.Cookie
		validatorErr error
		wantStatus   int
		wantBody     string
		wantNextRun  bool
	}{
		{
			name:        "valid session",
			cookie:      &http.Cookie{Name: testCookieName, Value: validToken},
			wantStatus:  http.StatusOK,
			wantBody:    testUserID.String(),
			wantNextRun: true,
		},
		{
			name:       "no cookie",
			wantStatus: http.StatusUnauthorized,
			wantBody:   `{"error":{"code":"UNAUTHENTICATED"}}`,
		},
		{
			name:       "cookie with another name",
			cookie:     &http.Cookie{Name: "other", Value: validToken},
			wantStatus: http.StatusUnauthorized,
			wantBody:   `{"error":{"code":"UNAUTHENTICATED"}}`,
		},
		{
			name:       "unknown or expired session",
			cookie:     &http.Cookie{Name: testCookieName, Value: "WRONG-TOKEN"},
			wantStatus: http.StatusUnauthorized,
			wantBody:   `{"error":{"code":"UNAUTHENTICATED"}}`,
		},
		{
			// The service wraps the sentinel; errors.Is must still find it.
			name:         "wrapped session not found",
			cookie:       &http.Cookie{Name: testCookieName, Value: validToken},
			validatorErr: fmt.Errorf("get session: %w", auth.ErrSessionNotFound),
			wantStatus:   http.StatusUnauthorized,
			wantBody:     `{"error":{"code":"UNAUTHENTICATED"}}`,
		},
		{
			name:         "database failure is not reported as logged out",
			cookie:       &http.Cookie{Name: testCookieName, Value: validToken},
			validatorErr: errors.New("connection refused"),
			wantStatus:   http.StatusInternalServerError,
			wantBody:     `{"error":{"code":"INTERNAL_ERROR"}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			validator := &fakeValidator{validToken: validToken, err: tt.validatorErr}
			nextRun := false
			next := func(w http.ResponseWriter, r *http.Request) {
				nextRun = true
				userID, ok := userIDFrom(r.Context())
				if !ok {
					t.Error("userIDFrom() found no user in the request context")
				}
				_, _ = w.Write([]byte(userID.String()))
			}

			req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
			if tt.cookie != nil {
				req.AddCookie(tt.cookie)
			}
			rec := httptest.NewRecorder()
			requireUser(validator, testEnv)(next).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
			if nextRun != tt.wantNextRun {
				t.Errorf("next handler ran = %t, want %t", nextRun, tt.wantNextRun)
			}
		})
	}
}

func TestRequireUser_renewsCookie(t *testing.T) {
	renewedUntil := time.Date(2026, time.March, 1, 12, 0, 0, 0, time.UTC)

	tests := []struct {
		name         string
		renewedUntil time.Time
		wantCookie   bool
	}{
		{name: "session renewed", renewedUntil: renewedUntil, wantCookie: true},
		// Most requests: without renewal the response sets no cookie.
		{name: "session not renewed", wantCookie: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			validator := &fakeValidator{validToken: "VALID-TOKEN", renewedUntil: tt.renewedUntil}
			req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
			req.AddCookie(&http.Cookie{Name: testCookieName, Value: "VALID-TOKEN"})
			rec := httptest.NewRecorder()

			requireUser(validator, testEnv)(func(w http.ResponseWriter, _ *http.Request) {
				// Writing the body sends the headers; the cookie must be
				// in them already.
				_, _ = w.Write([]byte("ok"))
			}).ServeHTTP(rec, req)

			cookie := findCookie(rec, testCookieName)
			if !tt.wantCookie {
				if cookie != nil {
					t.Errorf("cookie set without renewal: %v", cookie)
				}
				return
			}
			if cookie == nil {
				t.Fatal("renewed session did not refresh the cookie")
			}
			if cookie.Value != "VALID-TOKEN" {
				t.Errorf("Value = %q, want the unchanged token", cookie.Value)
			}
			if !cookie.Expires.Equal(renewedUntil) {
				t.Errorf("Expires = %v, want %v", cookie.Expires, renewedUntil)
			}
		})
	}
}

func TestRequireUser_passesCookieValue(t *testing.T) {
	validator := &fakeValidator{validToken: "VALID-TOKEN"}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.AddCookie(&http.Cookie{Name: testCookieName, Value: "VALID-TOKEN"})

	requireUser(validator, testEnv)(func(http.ResponseWriter, *http.Request) {}).
		ServeHTTP(httptest.NewRecorder(), req)

	if len(validator.gotTokens) != 1 || validator.gotTokens[0] != "VALID-TOKEN" {
		t.Errorf("validator got tokens %q, want [VALID-TOKEN]", validator.gotTokens)
	}
}

func TestRequireUser_noCookieSkipsValidation(t *testing.T) {
	validator := &fakeValidator{}

	requireUser(validator, testEnv)(func(http.ResponseWriter, *http.Request) {}).
		ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/me", nil))

	if len(validator.gotTokens) != 0 {
		t.Errorf("validator was called %d times without a cookie, want 0", len(validator.gotTokens))
	}
}

func TestUserIDFrom_missing(t *testing.T) {
	if _, ok := userIDFrom(context.Background()); ok {
		t.Error("userIDFrom() reported a user for a context without one")
	}
}

func TestSessionCookieName(t *testing.T) {
	tests := []struct {
		env  config.Env
		want string
	}{
		{env: config.EnvDevelopment, want: "session"},
		{env: config.EnvStaging, want: "__Host-session"},
		{env: config.EnvProduction, want: "__Host-session"},
	}

	for _, tt := range tests {
		t.Run(string(tt.env), func(t *testing.T) {
			if got := sessionCookieName(tt.env); got != tt.want {
				t.Errorf("sessionCookieName(%q) = %q, want %q", tt.env, got, tt.want)
			}
		})
	}
}
