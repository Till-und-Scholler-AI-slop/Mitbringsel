package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// fakePinger returns a fixed result, so the tests need no database.
type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) error { return f.err }

func TestRouter(t *testing.T) {
	tests := []struct {
		name       string
		db         Pinger
		method     string
		path       string
		wantStatus int
		wantBody   string
		wantAllow  string
	}{
		{
			name:       "health ok",
			db:         fakePinger{},
			method:     http.MethodGet,
			path:       "/api/v1/health",
			wantStatus: http.StatusOK,
			wantBody:   `{"status":"ok"}`,
		},
		{
			name:       "health with database down",
			db:         fakePinger{err: errors.New("connection refused")},
			method:     http.MethodGet,
			path:       "/api/v1/health",
			wantStatus: http.StatusServiceUnavailable,
			wantBody:   `{"error":{"code":"DB_UNAVAILABLE"}}`,
		},
		{
			name:       "wrong method on health",
			db:         fakePinger{},
			method:     http.MethodPost,
			path:       "/api/v1/health",
			wantStatus: http.StatusMethodNotAllowed,
			wantBody:   `{"error":{"code":"METHOD_NOT_ALLOWED"}}`,
			wantAllow:  "GET",
		},
		{
			name:       "unknown path",
			db:         fakePinger{},
			method:     http.MethodGet,
			path:       "/api/v1/nope",
			wantStatus: http.StatusNotFound,
			wantBody:   `{"error":{"code":"NOT_FOUND"}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			NewRouter(tt.db).ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := rec.Header().Get("Content-Type"); got != "application/json" {
				t.Errorf("Content-Type = %q, want application/json", got)
			}
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", got, tt.wantAllow)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
		})
	}
}
