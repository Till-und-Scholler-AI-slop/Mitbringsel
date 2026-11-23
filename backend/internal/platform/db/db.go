// Package db sets up the PostgreSQL connection pool and runs migrations.
package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"tuolino/db/migrations"
)

// NewPool opens a connection pool and verifies the database is reachable.
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	// pgxpool.New connects lazily, so ping once to fail fast at startup.
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

// Migrate applies all pending migrations. Running it again is a no-op.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	// goose speaks database/sql, pgx has its own API. The stdlib adapter
	// wraps the existing pool so goose can use the same connections.
	sqlDB := stdlib.OpenDBFromPool(pool)
	// The wrapper holds no state worth reporting on close; the blank
	// assignment makes ignoring the error explicit for errcheck.
	defer func() { _ = sqlDB.Close() }()

	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS)
	if err != nil {
		return fmt.Errorf("create migration provider: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}
