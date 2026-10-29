package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"mitbringsel/internal/auth"
	"mitbringsel/internal/config"
)

const testCookieName = "test-session"

var testUserID = uuid.MustParse("0190a8c4-0000-7000-8000-000000000001")

// fakeValidator accepts exactly one token and records what it was asked.
type fakeValidator struct {
	validToken string
	// err, if set, is returned for every token.
	err       error
	gotTokens []string
}

func (f *fakeValidator) Validate(_ context.Context, token string) (uuid.UUID, error) {
	f.gotTokens = append(f.gotTokens, token)
	if f.err != nil {
		return uuid.Nil, f.err
	}
	if token != f.validToken {
		return uuid.Nil, auth.ErrSessionNotFound
	}
	return testUserID, nil
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
			requireUser(validator, testCookieName)(next).ServeHTTP(rec, req)

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

func TestRequireUser_passesCookieValue(t *testing.T) {
	validator := &fakeValidator{validToken: "VALID-TOKEN"}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.AddCookie(&http.Cookie{Name: testCookieName, Value: "VALID-TOKEN"})

	requireUser(validator, testCookieName)(func(http.ResponseWriter, *http.Request) {}).
		ServeHTTP(httptest.NewRecorder(), req)

	if len(validator.gotTokens) != 1 || validator.gotTokens[0] != "VALID-TOKEN" {
		t.Errorf("validator got tokens %q, want [VALID-TOKEN]", validator.gotTokens)
	}
}

func TestRequireUser_noCookieSkipsValidation(t *testing.T) {
	validator := &fakeValidator{}

	requireUser(validator, testCookieName)(func(http.ResponseWriter, *http.Request) {}).
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
