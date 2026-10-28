// Package dbtest starts throwaway PostgreSQL containers for integration tests.
// Only test files import it, so it never ends up in the server binary.
package dbtest

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"

	"mitbringsel/internal/platform/db"
)

// Image matches the PostgreSQL version of deploy/docker-compose.dev.yml.
const Image = "postgres:18"

// NewPool returns a pool for a fresh database with all migrations applied.
// Each call starts its own container, so tests never share data.
func NewPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := NewEmptyPool(t)
	if err := db.Migrate(context.Background(), pool); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}
	return pool
}

// NewEmptyPool returns a pool for a fresh database without any migrations,
// for tests of the migrations themselves. Skipped with -short, because it
// needs a running Docker daemon.
func NewEmptyPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	ctx := context.Background()
	ctr, err := postgres.Run(ctx, Image, postgres.BasicWaitStrategies())
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() { _ = testcontainers.TerminateContainer(ctr) })

	url, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}

	pool, err := db.NewPool(ctx, url)
	if err != nil {
		t.Fatalf("NewPool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
