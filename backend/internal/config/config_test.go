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
		wantEnv   Env
		wantAddr  string
		wantLevel slog.Level
		wantErr   bool
	}{
		{
			name:      "defaults when only the required values are set",
			env:       map[string]string{"APP_ENV": "production", "DATABASE_URL": dbURL},
			wantEnv:   EnvProduction,
			wantAddr:  ":8080",
			wantLevel: slog.LevelInfo,
		},
		{
			name: "values from environment",
			env: map[string]string{
				"APP_ENV":      "development",
				"DATABASE_URL": dbURL,
				"HTTP_ADDR":    "127.0.0.1:9000",
				"LOG_LEVEL":    "debug",
			},
			wantEnv:   EnvDevelopment,
			wantAddr:  "127.0.0.1:9000",
			wantLevel: slog.LevelDebug,
		},
		{
			name:      "staging",
			env:       map[string]string{"APP_ENV": "staging", "DATABASE_URL": dbURL},
			wantEnv:   EnvStaging,
			wantAddr:  ":8080",
			wantLevel: slog.LevelInfo,
		},
		{
			name:    "missing app env",
			env:     map[string]string{"DATABASE_URL": dbURL},
			wantErr: true,
		},
		{
			name:    "unknown app env",
			env:     map[string]string{"APP_ENV": "prod", "DATABASE_URL": dbURL},
			wantErr: true,
		},
		{
			// Values are compared exactly; "Production" is a typo, not an alias.
			name:    "app env with wrong case",
			env:     map[string]string{"APP_ENV": "Production", "DATABASE_URL": dbURL},
			wantErr: true,
		},
		{
			name:    "missing database url",
			env:     map[string]string{"APP_ENV": "production"},
			wantErr: true,
		},
		{
			name:    "invalid log level",
			env:     map[string]string{"APP_ENV": "production", "DATABASE_URL": dbURL, "LOG_LEVEL": "loud"},
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
			if got.Env != tt.wantEnv {
				t.Errorf("Env = %q, want %q", got.Env, tt.wantEnv)
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
