package config

import (
	"log/slog"
	"maps"
	"testing"
)

const (
	dbURL        = "postgres://user:pass@localhost:5432/db"
	baseURL      = "https://mitbringsel.example.com"
	clientID     = "123-abc.apps.googleusercontent.com"
	clientSecret = "GOCSPX-secret"
)

// deployedEnv is the minimal environment staging and production start with.
func deployedEnv(appEnv string) map[string]string {
	return map[string]string{
		"APP_ENV":              appEnv,
		"DATABASE_URL":         dbURL,
		"PUBLIC_BASE_URL":      baseURL,
		"GOOGLE_CLIENT_ID":     clientID,
		"GOOGLE_CLIENT_SECRET": clientSecret,
	}
}

// with returns a copy of env with the given keys changed; an empty value
// removes the key, as an unset variable reads as "".
func with(env map[string]string, changes map[string]string) map[string]string {
	out := maps.Clone(env)
	for k, v := range changes {
		if v == "" {
			delete(out, k)
			continue
		}
		out[k] = v
	}
	return out
}

func TestLoad(t *testing.T) {
	devEnv := map[string]string{"APP_ENV": "development", "DATABASE_URL": dbURL}

	tests := []struct {
		name        string
		env         map[string]string
		wantEnv     Env
		wantAddr    string
		wantLevel   slog.Level
		wantBaseURL string
		wantGoogle  Google
		wantErr     bool
	}{
		{
			name:        "defaults when only the required values are set",
			env:         deployedEnv("production"),
			wantEnv:     EnvProduction,
			wantAddr:    ":8080",
			wantLevel:   slog.LevelInfo,
			wantBaseURL: baseURL,
			wantGoogle:  Google{ClientID: clientID, ClientSecret: clientSecret},
		},
		{
			name: "values from environment",
			env: with(deployedEnv("development"), map[string]string{
				"HTTP_ADDR":       "127.0.0.1:9000",
				"LOG_LEVEL":       "debug",
				"PUBLIC_BASE_URL": "http://localhost:5173/",
			}),
			wantEnv:     EnvDevelopment,
			wantAddr:    "127.0.0.1:9000",
			wantLevel:   slog.LevelDebug,
			wantBaseURL: "http://localhost:5173",
			wantGoogle:  Google{ClientID: clientID, ClientSecret: clientSecret},
		},
		{
			name:        "staging",
			env:         deployedEnv("staging"),
			wantEnv:     EnvStaging,
			wantAddr:    ":8080",
			wantLevel:   slog.LevelInfo,
			wantBaseURL: baseURL,
			wantGoogle:  Google{ClientID: clientID, ClientSecret: clientSecret},
		},
		{
			// Development needs neither Google nor a base URL: the dev login
			// works without them and Vite's address is the default.
			name:        "development without google",
			env:         devEnv,
			wantEnv:     EnvDevelopment,
			wantAddr:    ":8080",
			wantLevel:   slog.LevelInfo,
			wantBaseURL: "http://localhost:5173",
		},
		{
			name:    "missing app env",
			env:     with(deployedEnv("production"), map[string]string{"APP_ENV": ""}),
			wantErr: true,
		},
		{
			name:    "unknown app env",
			env:     deployedEnv("prod"),
			wantErr: true,
		},
		{
			// Values are compared exactly; "Production" is a typo, not an alias.
			name:    "app env with wrong case",
			env:     deployedEnv("Production"),
			wantErr: true,
		},
		{
			name:    "missing database url",
			env:     with(deployedEnv("production"), map[string]string{"DATABASE_URL": ""}),
			wantErr: true,
		},
		{
			name:    "invalid log level",
			env:     with(deployedEnv("production"), map[string]string{"LOG_LEVEL": "loud"}),
			wantErr: true,
		},
		{
			name:    "missing public base url outside development",
			env:     with(deployedEnv("staging"), map[string]string{"PUBLIC_BASE_URL": ""}),
			wantErr: true,
		},
		{
			name:    "plain http outside development",
			env:     with(deployedEnv("production"), map[string]string{"PUBLIC_BASE_URL": "http://mitbringsel.example.com"}),
			wantErr: true,
		},
		{
			name:    "public base url with a path",
			env:     with(deployedEnv("production"), map[string]string{"PUBLIC_BASE_URL": baseURL + "/app"}),
			wantErr: true,
		},
		{
			name:    "public base url without scheme",
			env:     with(deployedEnv("production"), map[string]string{"PUBLIC_BASE_URL": "mitbringsel.example.com"}),
			wantErr: true,
		},
		{
			name:    "missing google client outside development",
			env:     with(deployedEnv("production"), map[string]string{"GOOGLE_CLIENT_ID": "", "GOOGLE_CLIENT_SECRET": ""}),
			wantErr: true,
		},
		{
			name:    "google client id without secret in development",
			env:     with(devEnv, map[string]string{"GOOGLE_CLIENT_ID": clientID}),
			wantErr: true,
		},
		{
			name:    "google secret without client id in development",
			env:     with(devEnv, map[string]string{"GOOGLE_CLIENT_SECRET": clientSecret}),
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
			if got.PublicBaseURL != tt.wantBaseURL {
				t.Errorf("PublicBaseURL = %q, want %q", got.PublicBaseURL, tt.wantBaseURL)
			}
			if got.Google != tt.wantGoogle {
				t.Errorf("Google = %+v, want %+v", got.Google, tt.wantGoogle)
			}
			if got.Google.Enabled() != (tt.wantGoogle.ClientID != "") {
				t.Errorf("Google.Enabled() = %v", got.Google.Enabled())
			}
		})
	}
}
