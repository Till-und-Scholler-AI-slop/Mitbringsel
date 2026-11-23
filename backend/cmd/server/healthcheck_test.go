package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tuolino/internal/httpapi"
)

func TestHealthURL(t *testing.T) {
	tests := []struct {
		listenAddr string
		want       string
	}{
		{":8080", "http://127.0.0.1:8080/api/v1/health"},
		{"0.0.0.0:8080", "http://127.0.0.1:8080/api/v1/health"},
		{"[::]:8080", "http://127.0.0.1:8080/api/v1/health"},
		{"127.0.0.1:9000", "http://127.0.0.1:9000/api/v1/health"},
		{"[::1]:8080", "http://[::1]:8080/api/v1/health"},
	}
	for _, tt := range tests {
		t.Run(tt.listenAddr, func(t *testing.T) {
			got, err := healthURL(tt.listenAddr)
			if err != nil {
				t.Fatalf("healthURL(%q): %v", tt.listenAddr, err)
			}
			if got != tt.want {
				t.Errorf("healthURL(%q) = %q, want %q", tt.listenAddr, got, tt.want)
			}
		})
	}
}

func TestHealthURLInvalid(t *testing.T) {
	if _, err := healthURL("8080"); err == nil {
		t.Error("healthURL without port separator: want error, got nil")
	}
}

func TestHealthcheck(t *testing.T) {
	tests := []struct {
		name    string
		status  int
		wantErr bool
	}{
		{"healthy", http.StatusOK, false},
		{"database down", http.StatusServiceUnavailable, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != httpapi.HealthPath {
					t.Errorf("path = %q, want %q", r.URL.Path, httpapi.HealthPath)
				}
				w.WriteHeader(tt.status)
			}))
			defer srv.Close()

			// srv.URL is "http://127.0.0.1:PORT"; healthcheck expects a listen address.
			err := healthcheck(context.Background(), strings.TrimPrefix(srv.URL, "http://"))
			if (err != nil) != tt.wantErr {
				t.Errorf("healthcheck() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestHealthcheckServerNotRunning(t *testing.T) {
	// Start and stop a server to get a port that nothing listens on.
	srv := httptest.NewServer(http.NotFoundHandler())
	addr := strings.TrimPrefix(srv.URL, "http://")
	srv.Close()

	if err := healthcheck(context.Background(), addr); err == nil {
		t.Error("healthcheck against stopped server: want error, got nil")
	}
}
