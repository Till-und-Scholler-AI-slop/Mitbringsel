package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"time"

	"tuolino/internal/httpapi"
)

const healthcheckTimeout = 3 * time.Second

// healthcheck asks the running server for its health and returns an error
// unless it answers 200. The distroless image has no curl or wget, so the
// container healthcheck runs the server binary itself with -healthcheck.
func healthcheck(ctx context.Context, listenAddr string) error {
	url, err := healthURL(listenAddr)
	if err != nil {
		return err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}

	client := &http.Client{Timeout: healthcheckTimeout}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request %s: %w", url, err)
	}
	// Only the status code matters; the body is not read. Closing it is
	// still required to release the connection.
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("request %s: status %d", url, resp.StatusCode)
	}
	return nil
}

// healthURL turns the listen address into a URL the healthcheck can call.
// ":8080" or "0.0.0.0:8080" mean "all interfaces", which is not a valid
// target, so the healthcheck uses the loopback address instead.
func healthURL(listenAddr string) (string, error) {
	host, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		return "", fmt.Errorf("parse listen address %q: %w", listenAddr, err)
	}
	switch host {
	case "", "0.0.0.0", "::":
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port) + httpapi.HealthPath, nil
}
