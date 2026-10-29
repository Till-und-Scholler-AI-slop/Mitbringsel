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

	"mitbringsel/internal/config"
	"mitbringsel/internal/user"
)

// fakeUsers returns users from a map. Like the real service, it wraps
// user.ErrNotFound for unknown IDs.
type fakeUsers struct {
	users map[uuid.UUID]user.User
	// err, if set, is returned for every ID.
	err error
}

func (f fakeUsers) Get(_ context.Context, id uuid.UUID) (user.User, error) {
	if f.err != nil {
		return user.User{}, f.err
	}
	u, ok := f.users[id]
	if !ok {
		return user.User{}, fmt.Errorf("get user: %w", user.ErrNotFound)
	}
	return u, nil
}

func testUser() user.User {
	return user.User{
		ID:          testUserID,
		Email:       "anna@example.com",
		DisplayName: "Anna Müller",
		AvatarURL:   "https://example.com/anna.png",
		Locale:      user.LocaleDE,
		Theme:       user.ThemeSystem,
		CreatedAt:   time.Date(2026, time.January, 15, 12, 0, 0, 0, time.UTC),
	}
}

func TestMeHandler(t *testing.T) {
	withoutAvatar := testUser()
	withoutAvatar.AvatarURL = ""

	tests := []struct {
		name       string
		users      fakeUsers
		wantStatus int
		wantBody   string
	}{
		{
			name:       "user found",
			users:      fakeUsers{users: map[uuid.UUID]user.User{testUserID: testUser()}},
			wantStatus: http.StatusOK,
			wantBody: `{"id":"0190a8c4-0000-7000-8000-000000000001","email":"anna@example.com",` +
				`"displayName":"Anna Müller","avatarUrl":"https://example.com/anna.png","locale":"de","theme":"system"}`,
		},
		{
			name:       "user without avatar",
			users:      fakeUsers{users: map[uuid.UUID]user.User{testUserID: withoutAvatar}},
			wantStatus: http.StatusOK,
			wantBody: `{"id":"0190a8c4-0000-7000-8000-000000000001","email":"anna@example.com",` +
				`"displayName":"Anna Müller","avatarUrl":null,"locale":"de","theme":"system"}`,
		},
		{
			name:       "user deleted while session is valid",
			users:      fakeUsers{},
			wantStatus: http.StatusUnauthorized,
			wantBody:   `{"error":{"code":"UNAUTHENTICATED"}}`,
		},
		{
			name:       "database failure",
			users:      fakeUsers{err: errors.New("connection refused")},
			wantStatus: http.StatusInternalServerError,
			wantBody:   `{"error":{"code":"INTERNAL_ERROR"}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Puts the user ID into the context the way requireUser does.
			ctx := context.WithValue(context.Background(), userIDKey{}, testUserID)
			req := httptest.NewRequestWithContext(ctx, http.MethodGet, mePath, nil)
			rec := httptest.NewRecorder()

			meHandler(tt.users).ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
		})
	}
}

func TestMeHandler_withoutRequireUser(t *testing.T) {
	users := fakeUsers{users: map[uuid.UUID]user.User{testUserID: testUser()}}
	rec := httptest.NewRecorder()

	meHandler(users).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, mePath, nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}
}

// TestRouter_me goes through the real router, so it also checks that the
// route exists and requireUser sits in front of it.
func TestRouter_me(t *testing.T) {
	const validToken = "VALID-TOKEN"
	devCookie := sessionCookieName(config.EnvDevelopment)

	tests := []struct {
		name       string
		method     string
		cookie     *http.Cookie
		wantStatus int
		wantAllow  string
	}{
		{
			name:       "valid session",
			method:     http.MethodGet,
			cookie:     &http.Cookie{Name: devCookie, Value: validToken},
			wantStatus: http.StatusOK,
		},
		{
			name:       "no cookie",
			method:     http.MethodGet,
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "invalid session",
			method:     http.MethodGet,
			cookie:     &http.Cookie{Name: devCookie, Value: "WRONG-TOKEN"},
			wantStatus: http.StatusUnauthorized,
		},
		{
			name:       "wrong method",
			method:     http.MethodPost,
			cookie:     &http.Cookie{Name: devCookie, Value: validToken},
			wantStatus: http.StatusMethodNotAllowed,
			wantAllow:  "GET",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := NewRouter(Deps{
				Env:      config.EnvDevelopment,
				DB:       fakePinger{},
				Sessions: &fakeValidator{validToken: validToken},
				Users:    fakeUsers{users: map[uuid.UUID]user.User{testUserID: testUser()}},
			})
			req := httptest.NewRequest(tt.method, mePath, nil)
			if tt.cookie != nil {
				req.AddCookie(tt.cookie)
			}
			rec := httptest.NewRecorder()

			router.ServeHTTP(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", got, tt.wantAllow)
			}
		})
	}
}
