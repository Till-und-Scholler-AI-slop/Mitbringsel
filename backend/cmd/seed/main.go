// Command seed fills the local development database with dummy data. Start
// it with `make seed`. Unlike cmd/server it is not part of the Docker image.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"os/signal"

	"tuolino/db/seed"
	"tuolino/internal/config"
	"tuolino/internal/platform/db"
)

// devUserParam is the URL parameter the frontend reads to pick the dev user
// (frontend/src/services/devUser.ts).
const devUserParam = "devUser"

func main() {
	if err := run(); err != nil {
		slog.Error("seed failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}
	// Before connecting: a refused target must never be touched.
	if err := checkTarget(cfg.Env, cfg.DatabaseURL); err != nil {
		return err
	}

	// ctx is cancelled on Ctrl+C.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect database: %w", err)
	}
	defer pool.Close()

	// The seed needs the current schema, also on a fresh database.
	if err := db.Migrate(ctx, pool); err != nil {
		return fmt.Errorf("migrate database: %w", err)
	}

	summary, err := seed.Run(ctx, pool)
	if err != nil {
		return err
	}

	fmt.Printf("Seeded %d users, %d groups, %d lists and %d items.\n\n",
		len(summary.Users), summary.Groups, summary.Lists, summary.Items)
	fmt.Println("Log in with the dev login (open one in a private window to be two users at once):")
	for _, u := range summary.Users {
		fmt.Printf("  %-40s %s/?%s=%s\n", u.DisplayName, cfg.PublicBaseURL, devUserParam, url.QueryEscape(u.Email))
	}
	return nil
}
