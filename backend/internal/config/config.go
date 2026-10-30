// Package config loads the server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strings"
)

const (
	envAppEnv      = "APP_ENV"
	envHTTPAddr    = "HTTP_ADDR"
	envLogLevel    = "LOG_LEVEL"
	envDatabaseURL = "DATABASE_URL"

	envPublicBaseURL      = "PUBLIC_BASE_URL"
	envGoogleClientID     = "GOOGLE_CLIENT_ID"
	envGoogleClientSecret = "GOOGLE_CLIENT_SECRET"

	defaultHTTPAddr = ":8080"
	defaultLogLevel = "info"
	// The Vite dev server, which forwards /api to this server.
	defaultDevPublicBaseURL = "http://localhost:5173"
)

// Env is the environment the server runs in. It only switches behaviour that
// must differ between environments, such as the dev login; everything else
// is plain configuration.
type Env string

const (
	EnvDevelopment Env = "development"
	EnvStaging     Env = "staging"
	EnvProduction  Env = "production"
)

// Config holds all settings the server needs at startup.
type Config struct {
	Env         Env
	HTTPAddr    string
	LogLevel    slog.Level
	DatabaseURL string
	// PublicBaseURL is where browsers reach the app, e.g.
	// "https://mitbringsel.tinowolter.com", without a trailing slash. Links
	// that leave the server (the Google redirect URL) are built from it,
	// never from the Host header, which a client can set to anything.
	PublicBaseURL string
	Google        Google
}

// Google is the OAuth client registered in the Google Cloud Console. Both
// fields are empty if the Google login is off, which only development
// allows (the dev login works without it).
type Google struct {
	ClientID     string
	ClientSecret string
}

// Enabled reports whether the Google login is configured.
func (g Google) Enabled() bool {
	return g.ClientID != ""
}

// Load reads the configuration from the process environment.
func Load() (Config, error) {
	return load(os.Getenv)
}

// load takes the lookup function as a parameter so tests can pass a fake
// environment instead of mutating the real one.
func load(getenv func(string) string) (Config, error) {
	cfg := Config{
		HTTPAddr:    valueOrDefault(getenv(envHTTPAddr), defaultHTTPAddr),
		DatabaseURL: getenv(envDatabaseURL),
	}

	// No default on purpose: a server that guesses its environment could
	// end up with the dev login enabled in production.
	env, err := parseEnv(getenv(envAppEnv))
	if err != nil {
		return Config{}, err
	}
	cfg.Env = env

	// No default on purpose: silently falling back to some database would
	// hide a misconfigured deployment.
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New(envDatabaseURL + " is required")
	}

	cfg.PublicBaseURL, err = parsePublicBaseURL(getenv(envPublicBaseURL), env)
	if err != nil {
		return Config{}, err
	}

	cfg.Google, err = parseGoogle(getenv(envGoogleClientID), getenv(envGoogleClientSecret), env)
	if err != nil {
		return Config{}, err
	}

	levelText := valueOrDefault(getenv(envLogLevel), defaultLogLevel)
	if err := cfg.LogLevel.UnmarshalText([]byte(levelText)); err != nil {
		return Config{}, fmt.Errorf("parse %s %q: %w", envLogLevel, levelText, err)
	}

	return cfg, nil
}

func parseEnv(value string) (Env, error) {
	switch env := Env(value); env {
	case EnvDevelopment, EnvStaging, EnvProduction:
		return env, nil
	case "":
		return "", errors.New(envAppEnv + " is required")
	default:
		return "", fmt.Errorf("%s %q is invalid, want %s, %s or %s",
			envAppEnv, value, EnvDevelopment, EnvStaging, EnvProduction)
	}
}

// parsePublicBaseURL accepts an origin such as "https://example.com" and
// returns it without a trailing slash. Outside development it is required
// and must use HTTPS, because the session cookie is only sent over HTTPS.
func parsePublicBaseURL(value string, env Env) (string, error) {
	if value == "" {
		if env != EnvDevelopment {
			return "", errors.New(envPublicBaseURL + " is required")
		}
		value = defaultDevPublicBaseURL
	}

	u, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("parse %s %q: %w", envPublicBaseURL, value, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("%s %q must start with http:// or https://", envPublicBaseURL, value)
	}
	if env != EnvDevelopment && u.Scheme != "https" {
		return "", fmt.Errorf("%s %q must use https outside development", envPublicBaseURL, value)
	}
	// Only an origin: paths are appended to it, so one here would end up in
	// the middle of every URL built from it.
	if u.Host == "" || strings.TrimSuffix(u.Path, "/") != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
		return "", fmt.Errorf("%s %q must be scheme and host only, like https://example.com", envPublicBaseURL, value)
	}
	return u.Scheme + "://" + u.Host, nil
}

// parseGoogle requires the Google client outside development. In
// development it is optional, but half a configuration is an error: it is
// almost certainly a typo, not a wish to turn the login off.
func parseGoogle(clientID, clientSecret string, env Env) (Google, error) {
	g := Google{ClientID: clientID, ClientSecret: clientSecret}
	switch {
	case clientID != "" && clientSecret != "":
		return g, nil
	case clientID == "" && clientSecret == "" && env == EnvDevelopment:
		return Google{}, nil
	case clientID == "":
		return Google{}, errors.New(envGoogleClientID + " is required")
	default:
		return Google{}, errors.New(envGoogleClientSecret + " is required")
	}
}

func valueOrDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
