// Package config loads the server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
)

const (
	envAppEnv      = "APP_ENV"
	envHTTPAddr    = "HTTP_ADDR"
	envLogLevel    = "LOG_LEVEL"
	envDatabaseURL = "DATABASE_URL"

	defaultHTTPAddr = ":8080"
	defaultLogLevel = "info"
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

func valueOrDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
