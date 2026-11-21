package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"mitbringsel/internal/auth"
	"mitbringsel/internal/cleanup"
	"mitbringsel/internal/config"
	"mitbringsel/internal/group"
	"mitbringsel/internal/httpapi"
	"mitbringsel/internal/item"
	"mitbringsel/internal/list"
	"mitbringsel/internal/platform/db"
	"mitbringsel/internal/platform/db/sqlcgen"
	"mitbringsel/internal/realtime"
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
	// The hub comes first: the broadcaster hands the events of the services
	// to it.
	hub := realtime.NewHub(realtime.DefaultMaxConnsPerUser, realtime.DefaultSendBuffer)
	broadcaster := httpapi.NewBroadcaster(hub)
	// Unlike the other repositories, this one takes the pool: it starts the
	// transactions that keep a group and its owner together.
	groupRepo := group.NewPostgresRepository(pool)
	groups := group.NewService(groupRepo, broadcaster)
	invites := group.NewInviteService(groupRepo, broadcaster)
	// The group repository doubles as the list service's membership lookup.
	lists := list.NewService(list.NewPostgresRepository(queries), groupRepo, broadcaster)
	// Items check access through the list service and publish their changes
	// to the broadcaster.
	items := item.NewService(item.NewPostgresRepository(pool), lists, broadcaster)
	itemClock, err := newItemClock()
	if err != nil {
		return err
	}

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

	var wsHandlers sync.WaitGroup
	srv := &http.Server{
		Addr: cfg.HTTPAddr,
		Handler: httpapi.NewRouter(httpapi.Deps{
			Env:           cfg.Env,
			DB:            pool,
			Sessions:      sessions,
			Users:         users,
			Groups:        groups,
			Invites:       invites,
			Lists:         lists,
			Items:         items,
			ItemClock:     itemClock,
			Hub:           hub,
			WSHandlers:    &wsHandlers,
			PublicBaseURL: cfg.PublicBaseURL,
			Google:        google,
		}),
		// Only the header timeout, never ReadTimeout or WriteTimeout: they
		// stay in force as deadlines on a connection after it has been
		// hijacked for a WebSocket, and would cut every live connection.
		ReadHeaderTimeout: readHeaderTimeout,
	}
	// Shutdown does not touch hijacked connections such as WebSockets, so the
	// hub closes them. RegisterOnShutdown runs the function in a goroutine of
	// its own when Shutdown starts.
	srv.RegisterOnShutdown(hub.Close)

	// The cleanup job runs next to the server until ctx ends. The method
	// values (sessions.DeleteExpired) are the methods bound to their
	// service, so they fit the func type of Task.Run.
	cleanupDone := make(chan struct{})
	go func() {
		defer close(cleanupDone)
		cleanup.Run(ctx, cleanup.DefaultInterval, []cleanup.Task{
			{Name: "expired sessions", Run: sessions.DeleteExpired},
			{Name: "stale invites", Run: invites.DeleteStale},
			{Name: "item tombstones", Run: items.DeleteOldTombstones},
		})
	}()

	serveErr := make(chan error, 1)
	go func() {
		slog.Info("server listening", "addr", cfg.HTTPAddr)
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		// stop also cancels ctx, which ends the cleanup.
		stop()
		<-cleanupDone
		return fmt.Errorf("listen: %w", err)
	case <-ctx.Done():
		slog.Info("shutdown signal received")
	}

	// Give in-flight requests and active WebSocket close frames time to
	// finish, but not forever.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()

	if err := shutdownServer(shutdownCtx, srv, &wsHandlers); err != nil {
		return err
	}
	// ctx is cancelled, so the cleanup ends quickly; waiting keeps it from
	// running a query while the deferred pool.Close shuts the pool.
	<-cleanupDone
	return nil
}

// shutdownServer stops accepting new connections, waits for in-flight HTTP
// requests, and then waits for active WebSocket handlers to finish writing
// their close frames within ctx.
func shutdownServer(ctx context.Context, srv *http.Server, wsHandlers *sync.WaitGroup) error {
	if err := srv.Shutdown(ctx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("shutdown: %w", err)
	}
	if err := waitWithContext(ctx, wsHandlers); err != nil {
		return fmt.Errorf("wait for websocket handlers: %w", err)
	}
	return nil
}

// waitWithContext waits until wg finishes or ctx expires.
func waitWithContext(ctx context.Context, wg *sync.WaitGroup) error {
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// newItemClock returns the clock for item changes made over REST. Its node
// ID is random per process, so two server processes never issue the same
// clock (docs/sync.md).
func newItemClock() (*item.Clock, error) {
	suffix := make([]byte, 3)
	if _, err := rand.Read(suffix); err != nil {
		return nil, fmt.Errorf("random node id: %w", err)
	}
	clock, err := item.NewClock("srv-"+hex.EncodeToString(suffix), time.Now)
	if err != nil {
		return nil, fmt.Errorf("create item clock: %w", err)
	}
	return clock, nil
}
