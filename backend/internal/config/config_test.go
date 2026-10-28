package config

import (
	"log/slog"
	"testing"
)

func TestLoad(t *testing.T) {
	const dbURL = "postgres://user:pass@localhost:5432/db"

	tests := []struct {
		name      string
		env       map[string]string
		wantAddr  string
		wantLevel slog.Level
		wantErr   bool
	}{
		{
			name:      "defaults when only the database url is set",
			env:       map[string]string{"DATABASE_URL": dbURL},
			wantAddr:  ":8080",
			wantLevel: slog.LevelInfo,
		},
		{
			name: "values from environment",
			env: map[string]string{
				"DATABASE_URL": dbURL,
				"HTTP_ADDR":    "127.0.0.1:9000",
				"LOG_LEVEL":    "debug",
			},
			wantAddr:  "127.0.0.1:9000",
			wantLevel: slog.LevelDebug,
		},
		{
			name:    "missing database url",
			env:     map[string]string{},
			wantErr: true,
		},
		{
			name:    "invalid log level",
			env:     map[string]string{"DATABASE_URL": dbURL, "LOG_LEVEL": "loud"},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := load(func(key string) string { return tt.env[key] })

			if (err != nil) != tt.wantErr {
				t.Fatalf("load() error = %v, wantErr %v", err, tt.wantErr)
			}
			if tt.wantErr {
				return
			}
			if got.HTTPAddr != tt.wantAddr {
				t.Errorf("HTTPAddr = %q, want %q", got.HTTPAddr, tt.wantAddr)
			}
			if got.LogLevel != tt.wantLevel {
				t.Errorf("LogLevel = %v, want %v", got.LogLevel, tt.wantLevel)
			}
			if got.DatabaseURL != dbURL {
				t.Errorf("DatabaseURL = %q, want %q", got.DatabaseURL, dbURL)
			}
		})
	}
}
