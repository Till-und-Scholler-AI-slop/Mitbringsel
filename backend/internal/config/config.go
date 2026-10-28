// Package config loads the server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
)

const (
	envHTTPAddr    = "HTTP_ADDR"
	envLogLevel    = "LOG_LEVEL"
	envDatabaseURL = "DATABASE_URL"

	defaultHTTPAddr = ":8080"
	defaultLogLevel = "info"
)

// Config holds all settings the server needs at startup.
type Config struct {
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

func valueOrDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
