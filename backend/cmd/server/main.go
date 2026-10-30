package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"mitbringsel/internal/auth"
	"mitbringsel/internal/config"
	"mitbringsel/internal/httpapi"
	"mitbringsel/internal/platform/db"
	"mitbringsel/internal/platform/db/sqlcgen"
	"mitbringsel/internal/user"
)

const (
	readHeaderTimeout = 5 * time.Second
	shutdownTimeout   = 10 * time.Second
)

func main() {
	if err := run(); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

// run holds the real startup logic. main only reports its error, because
// os.Exit would skip deferred calls inside main itself.
func run() error {
	migrateOnly := flag.Bool("migrate-only", false, "apply database migrations and exit")
	healthcheckOnly := flag.Bool("healthcheck", false, "check the health of the running server and exit")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: cfg.LogLevel})))

	// ctx is cancelled on Ctrl+C or SIGTERM (what Docker sends on stop).
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Checked before connecting to the database: the healthcheck runs as a
	// separate process next to the server and only talks to it over HTTP.
	if *healthcheckOnly {
		return healthcheck(ctx, cfg.HTTPAddr)
	}

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer pool.Close()

	if err := db.Migrate(ctx, pool); err != nil {
		return fmt.Errorf("migrate database: %w", err)
	}
	if *migrateOnly {
		slog.Info("migrations applied")
		return nil
	}

	// Wiring by hand: each service gets its repository through the
	// constructor. All repositories share one set of sqlc queries.
	queries := sqlcgen.New(pool)
	sessions := auth.NewSessionService(auth.NewPostgresSessionRepository(queries))
	users := user.NewService(user.NewPostgresRepository(queries))

	// Declared with the interface type and only assigned when configured:
	// an interface holding a nil *auth.GoogleProvider would not compare
	// equal to nil, and the router would register routes that crash.
	var google httpapi.GoogleLogin
	if cfg.Google.Enabled() {
		google = auth.NewGoogleProvider(cfg.Google.ClientID, cfg.Google.ClientSecret,
			cfg.PublicBaseURL+httpapi.GoogleCallbackPath)
	} else {
		slog.Info("google login disabled: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set")
	}

	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpapi.NewRouter(httpapi.Deps{
			Env:      cfg.Env,
			DB:       pool,
			Sessions: sessions,
			Users:    users,
			Google:   google,
		}),
		ReadHeaderTimeout: readHeaderTimeout,
	}

	serveErr := make(chan error, 1)
	go func() {
		slog.Info("server listening", "addr", cfg.HTTPAddr)
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		return fmt.Errorf("listen: %w", err)
	case <-ctx.Done():
		slog.Info("shutdown signal received")
	}

	// Give in-flight requests time to finish, but not forever.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("shutdown: %w", err)
	}
	return nil
}
