package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"tuolino/internal/config"
)

const newToken = "NEW-TOKEN"

// Whole seconds, because the Expires attribute of a cookie has no
// sub-second part.
var testExpiry = time.Date(2026, time.February, 14, 12, 0, 0, 0, time.UTC)

// fakeSessions embeds fakeValidator: its Validate method is promoted, so
// fakeSessions only adds Create and Delete to satisfy SessionManager.
type fakeSessions struct {
	fakeValidator
	createErr error
	deleteErr error
	created   []uuid.UUID
	deleted   []string
}

func (f *fakeSessions) Create(_ context.Context, userID uuid.UUID) (string, time.Time, error) {
	if f.createErr != nil {
		return "", time.Time{}, f.createErr
	}
	f.created = append(f.created, userID)
	return newToken, testExpiry, nil
}

func (f *fakeSessions) Delete(_ context.Context, token string) error {
	f.deleted = append(f.deleted, token)
	return f.deleteErr
}

func newAuthRouter(env config.Env, sessions *fakeSessions, users *fakeUsers) http.Handler {
	return NewRouter(Deps{Env: env, DB: fakePinger{}, Sessions: sessions, Users: users})
}

// findCookie returns the cookie the response sets, or nil.
func findCookie(rec *httptest.ResponseRecorder, name string) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func TestLogout(t *testing.T) {
	devCookie := sessionCookieName(config.EnvDevelopment)

	tests := []struct {
		name        string
		cookie      *http.Cookie
		deleteErr   error
		wantStatus  int
		wantDeleted []string
	}{
		{
			name:        "with session",
			cookie:      &http.Cookie{Name: devCookie, Value: "SOME-TOKEN"},
			wantStatus:  http.StatusNoContent,
			wantDeleted: []string{"SOME-TOKEN"},
		},
		{
			name:       "without cookie",
			wantStatus: http.StatusNoContent,
		},
		{
			name:        "database failure still clears the cookie",
			cookie:      &http.Cookie{Name: devCookie, Value: "SOME-TOKEN"},
			deleteErr:   errors.New("connection refused"),
			wantStatus:  http.StatusInternalServerError,
			wantDeleted: []string{"SOME-TOKEN"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sessions := &fakeSessions{deleteErr: tt.deleteErr}
			req := httptest.NewRequest(http.MethodPost, logoutPath, nil)
			if tt.cookie != nil {
				req.AddCookie(tt.cookie)
			}
			rec := httptest.NewRecorder()

			newAuthRouter(config.EnvDevelopment, sessions, &fakeUsers{}).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if strings.Join(sessions.deleted, ",") != strings.Join(tt.wantDeleted, ",") {
				t.Errorf("deleted sessions = %q, want %q", sessions.deleted, tt.wantDeleted)
			}
			cleared := findCookie(rec, devCookie)
			if cleared == nil || cleared.MaxAge >= 0 {
				t.Errorf("cookie not cleared, got %v", cleared)
			}
		})
	}
}

func TestDevLogin(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		usersErr   error
		createErr  error
		wantStatus int
		wantBody   string
		// wantSubject is checked when SignIn is expected to run.
		wantSubject string
	}{
		{
			name:        "success",
			body:        `{"email":"anna@example.com","name":"Anna"}`,
			wantStatus:  http.StatusNoContent,
			wantSubject: "dev:anna@example.com",
		},
		{
			name:        "email with surrounding spaces",
			body:        `{"email":" anna@example.com ","name":"Anna"}`,
			wantStatus:  http.StatusNoContent,
			wantSubject: "dev:anna@example.com",
		},
		{
			name:       "broken json",
			body:       `{"email":`,
			wantStatus: http.StatusBadRequest,
			wantBody:   `{"error":{"code":"INVALID_REQUEST"}}`,
		},
		{
			name:       "body too large",
			body:       `{"email":"anna@example.com","name":"` + strings.Repeat("a", maxDevLoginBodyBytes) + `"}`,
			wantStatus: http.StatusBadRequest,
			wantBody:   `{"error":{"code":"INVALID_REQUEST"}}`,
		},
		{
			name:        "missing email",
			body:        `{"name":"Anna"}`,
			wantStatus:  http.StatusBadRequest,
			wantBody:    `{"error":{"code":"INVALID_IDENTITY"}}`,
			wantSubject: "dev:",
		},
		{
			name:        "sign in fails",
			body:        `{"email":"anna@example.com"}`,
			usersErr:    errors.New("connection refused"),
			wantStatus:  http.StatusInternalServerError,
			wantBody:    `{"error":{"code":"INTERNAL_ERROR"}}`,
			wantSubject: "dev:anna@example.com",
		},
		{
			name:        "session creation fails",
			body:        `{"email":"anna@example.com"}`,
			createErr:   errors.New("connection refused"),
			wantStatus:  http.StatusInternalServerError,
			wantBody:    `{"error":{"code":"INTERNAL_ERROR"}}`,
			wantSubject: "dev:anna@example.com",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sessions := &fakeSessions{createErr: tt.createErr}
			users := &fakeUsers{err: tt.usersErr}
			req := httptest.NewRequest(http.MethodPost, devLoginPath, strings.NewReader(tt.body))
			rec := httptest.NewRecorder()

			newAuthRouter(config.EnvDevelopment, sessions, users).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
			if tt.wantSubject != "" {
				if len(users.signIns) != 1 || users.signIns[0].Subject != tt.wantSubject {
					t.Errorf("SignIn called with %+v, want subject %q", users.signIns, tt.wantSubject)
				}
			}

			cookie := findCookie(rec, sessionCookieName(config.EnvDevelopment))
			if tt.wantStatus != http.StatusNoContent {
				if cookie != nil {
					t.Errorf("failed login set a cookie: %v", cookie)
				}
				return
			}
			if cookie == nil || cookie.Value != newToken {
				t.Fatalf("session cookie = %v, want value %q", cookie, newToken)
			}
			if len(sessions.created) != 1 || sessions.created[0] != testUserID {
				t.Errorf("sessions created for %v, want [%v]", sessions.created, testUserID)
			}
		})
	}
}

// TestDevLogin_onlyInDevelopment guards the most important property of the
// dev login: it must not exist on staging or production.
func TestDevLogin_onlyInDevelopment(t *testing.T) {
	for _, env := range []config.Env{config.EnvStaging, config.EnvProduction} {
		t.Run(string(env), func(t *testing.T) {
			sessions := &fakeSessions{}
			users := &fakeUsers{}
			req := httptest.NewRequest(http.MethodPost, devLoginPath,
				strings.NewReader(`{"email":"anna@example.com"}`))
			rec := httptest.NewRecorder()

			newAuthRouter(env, sessions, users).ServeHTTP(rec, req)

			if rec.Code != http.StatusNotFound {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusNotFound)
			}
			if len(users.signIns) != 0 || len(sessions.created) != 0 {
				t.Error("dev login ran outside development")
			}
		})
	}
}

func TestSetSessionCookie(t *testing.T) {
	tests := []struct {
		env        config.Env
		wantName   string
		wantSecure bool
	}{
		{env: config.EnvDevelopment, wantName: "session", wantSecure: false},
		{env: config.EnvStaging, wantName: "__Host-session", wantSecure: true},
		{env: config.EnvProduction, wantName: "__Host-session", wantSecure: true},
	}

	for _, tt := range tests {
		t.Run(string(tt.env), func(t *testing.T) {
			rec := httptest.NewRecorder()
			setSessionCookie(rec, tt.env, newToken, testExpiry)

			c := findCookie(rec, tt.wantName)
			if c == nil {
				t.Fatalf("no cookie named %q set", tt.wantName)
			}
			if c.Value != newToken {
				t.Errorf("Value = %q, want %q", c.Value, newToken)
			}
			if c.Path != "/" {
				t.Errorf("Path = %q, want /", c.Path)
			}
			if c.Domain != "" {
				t.Errorf("Domain = %q, want none", c.Domain)
			}
			if !c.HttpOnly {
				t.Error("HttpOnly is not set")
			}
			if c.Secure != tt.wantSecure {
				t.Errorf("Secure = %t, want %t", c.Secure, tt.wantSecure)
			}
			if c.SameSite != http.SameSiteLaxMode {
				t.Errorf("SameSite = %v, want Lax", c.SameSite)
			}
			if !c.Expires.Equal(testExpiry) {
				t.Errorf("Expires = %v, want %v", c.Expires, testExpiry)
			}
		})
	}
}

// TestCrossOriginProtection uses logout as an example of a state-changing
// request; the protection wraps the whole router.
func TestCrossOriginProtection(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		path       string
		headers    map[string]string
		wantStatus int
	}{
		{
			name:       "post from another site",
			method:     http.MethodPost,
			path:       logoutPath,
			headers:    map[string]string{"Sec-Fetch-Site": "cross-site"},
			wantStatus: http.StatusForbidden,
		},
		{
			// Older browsers send no Sec-Fetch-Site; then Origin must
			// match Host (httptest uses example.com).
			name:       "post with foreign origin and no sec-fetch-site",
			method:     http.MethodPost,
			path:       logoutPath,
			headers:    map[string]string{"Origin": "https://evil.example"},
			wantStatus: http.StatusForbidden,
		},
		{
			name:       "post from the same site",
			method:     http.MethodPost,
			path:       logoutPath,
			headers:    map[string]string{"Sec-Fetch-Site": "same-origin"},
			wantStatus: http.StatusNoContent,
		},
		{
			// curl and other non-browser clients send neither header.
			name:       "post without browser headers",
			method:     http.MethodPost,
			path:       logoutPath,
			wantStatus: http.StatusNoContent,
		},
		{
			name:       "get from another site passes",
			method:     http.MethodGet,
			path:       HealthPath,
			headers:    map[string]string{"Sec-Fetch-Site": "cross-site"},
			wantStatus: http.StatusOK,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sessions := &fakeSessions{}
			req := httptest.NewRequest(tt.method, tt.path, nil)
			req.AddCookie(&http.Cookie{Name: sessionCookieName(config.EnvDevelopment), Value: "SOME-TOKEN"})
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}
			rec := httptest.NewRecorder()

			newAuthRouter(config.EnvDevelopment, sessions, &fakeUsers{}).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if tt.wantStatus == http.StatusForbidden {
				if got := strings.TrimSpace(rec.Body.String()); got != `{"error":{"code":"CROSS_ORIGIN_REQUEST"}}` {
					t.Errorf("body = %s", got)
				}
				if len(sessions.deleted) != 0 {
					t.Error("rejected request still reached the handler")
				}
			}
		})
	}
}
