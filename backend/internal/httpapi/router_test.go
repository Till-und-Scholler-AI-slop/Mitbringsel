package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestRouterFallback checks that unknown paths and wrong methods get the JSON
// error format, also for paths with a wildcard like /items/{id}, where the
// request path ("/items/42") differs from the registered pattern.
func TestRouterFallback(t *testing.T) {
	ok := func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
		wantAllow  string
	}{
		{name: "fixed path", method: http.MethodGet, path: "/things", wantStatus: http.StatusOK},
		{name: "wildcard path", method: http.MethodGet, path: "/items/42", wantStatus: http.StatusOK},
		{name: "unknown path", method: http.MethodGet, path: "/nothing", wantStatus: http.StatusNotFound},
		{
			name:       "wrong method on fixed path",
			method:     http.MethodPost,
			path:       "/things",
			wantStatus: http.StatusMethodNotAllowed,
			wantAllow:  "GET",
		},
		{
			name:       "wrong method on wildcard path",
			method:     http.MethodPut,
			path:       "/items/42",
			wantStatus: http.StatusMethodNotAllowed,
			wantAllow:  "GET, DELETE",
		},
		{
			name:       "wrong method on nested wildcard path",
			method:     http.MethodPost,
			path:       "/items/42/parts/7",
			wantStatus: http.StatusMethodNotAllowed,
			wantAllow:  "PATCH",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := &router{mux: http.NewServeMux()}
			r.handle(http.MethodGet, "/things", ok)
			r.handle(http.MethodGet, "/items/{id}", ok)
			r.handle(http.MethodDelete, "/items/{id}", ok)
			r.handle(http.MethodPatch, "/items/{id}/parts/{partId}", ok)
			r.mux.HandleFunc("/", r.fallback)

			rec := httptest.NewRecorder()
			r.mux.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", got, tt.wantAllow)
			}
		})
	}
}
