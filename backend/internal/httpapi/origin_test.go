package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOriginAllowed(t *testing.T) {
	const base = "https://app.example.com"

	tests := []struct {
		name    string
		origin  string
		baseURL string
		want    bool
	}{
		{name: "same origin", origin: "https://app.example.com", want: true},
		{name: "case differs", origin: "https://APP.Example.COM", want: true},
		{name: "no origin header", origin: "", want: true},
		{name: "other scheme, same host", origin: "http://app.example.com", want: true},
		{name: "other port", origin: "https://app.example.com:8443", want: false},
		{name: "sibling subdomain", origin: "https://evil.example.com", want: false},
		{name: "parent domain", origin: "https://example.com", want: false},
		{name: "base host as prefix of another host", origin: "https://app.example.com.evil.com", want: false},
		{name: "base host as suffix of another host", origin: "https://evilapp.example.com", want: false},
		{name: "base host in the user info", origin: "https://app.example.com@evil.com", want: false},
		{name: "null origin", origin: "null", want: false},
		{name: "garbage", origin: "://not a url", want: false},
		{name: "no host", origin: "https://", want: false},
		{name: "development with port", baseURL: "http://localhost:5173", origin: "http://localhost:5173", want: true},
		{name: "development, other port", baseURL: "http://localhost:5173", origin: "http://localhost:3000", want: false},
		{name: "development, port missing", baseURL: "http://localhost:5173", origin: "http://localhost", want: false},
		{name: "base URL unusable", baseURL: "://", origin: "https://app.example.com", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			baseURL := tt.baseURL
			if baseURL == "" {
				baseURL = base
			}
			if got := originAllowed(tt.origin, baseURL); got != tt.want {
				t.Errorf("originAllowed(%q, %q) = %v, want %v", tt.origin, baseURL, got, tt.want)
			}
		})
	}
}

func TestRequireOrigin(t *testing.T) {
	tests := []struct {
		name       string
		origin     string
		wantStatus int
		wantBody   string
		wantNext   bool
	}{
		{name: "same host", origin: "https://app.example.com", wantStatus: http.StatusNoContent, wantNext: true},
		{name: "no origin header", wantStatus: http.StatusNoContent, wantNext: true},
		{name: "other site", origin: "https://evil.example.org", wantStatus: http.StatusForbidden, wantBody: errorBody("CROSS_ORIGIN_REQUEST")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			nextRan := false
			handler := requireOrigin("https://app.example.com")(func(w http.ResponseWriter, _ *http.Request) {
				nextRan = true
				w.WriteHeader(http.StatusNoContent)
			})

			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if tt.origin != "" {
				req.Header.Set("Origin", tt.origin)
			}
			rec := httptest.NewRecorder()
			handler(rec, req)

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if tt.wantBody != "" && strings.TrimSpace(rec.Body.String()) != tt.wantBody {
				t.Errorf("body = %q, want %q", rec.Body.String(), tt.wantBody)
			}
			if nextRan != tt.wantNext {
				t.Errorf("next handler ran = %v, want %v", nextRan, tt.wantNext)
			}
		})
	}
}
