// External test package (db_test instead of db): dbtest imports db, so an
// internal test importing dbtest would form an import cycle.
package db_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"tuolino/db/migrations"
	"tuolino/internal/platform/db"
	"tuolino/internal/platform/db/dbtest"
)

func TestMigrate(t *testing.T) {
	pool := dbtest.NewEmptyPool(t)
	ctx := context.Background()

	// Twice on purpose: the second run must be a harmless no-op.
	for i := 1; i <= 2; i++ {
		if err := db.Migrate(ctx, pool); err != nil {
			t.Fatalf("Migrate run %d: %v", i, err)
		}
	}

	var applied int
	err := pool.QueryRow(ctx, `SELECT count(*) FROM goose_db_version WHERE version_id = 1`).Scan(&applied)
	if err != nil {
		t.Fatalf("query goose_db_version: %v", err)
	}
	if applied != 1 {
		t.Errorf("baseline migration recorded %d times, want 1", applied)
	}
}

// TestMigrate_downAndUp proves every Down section works: a broken one would
// otherwise only show up when a rollback is needed in an emergency.
func TestMigrate_downAndUp(t *testing.T) {
	pool := dbtest.NewEmptyPool(t)
	ctx := context.Background()

	sqlDB := stdlib.OpenDBFromPool(pool)
	t.Cleanup(func() { _ = sqlDB.Close() })
	provider, err := goose.NewProvider(goose.DialectPostgres, sqlDB, migrations.FS)
	if err != nil {
		t.Fatalf("create migration provider: %v", err)
	}

	tables := []string{"users", "sessions"}

	if _, err := provider.Up(ctx); err != nil {
		t.Fatalf("first Up: %v", err)
	}
	assertTablesExist(t, pool, tables, true)

	if _, err := provider.DownTo(ctx, 0); err != nil {
		t.Fatalf("DownTo(0): %v", err)
	}
	assertTablesExist(t, pool, tables, false)

	if _, err := provider.Up(ctx); err != nil {
		t.Fatalf("second Up: %v", err)
	}
	assertTablesExist(t, pool, tables, true)
}

// assertTablesExist checks each table against want. to_regclass returns NULL
// for a missing table instead of failing, which pgx scans into a nil pointer.
func assertTablesExist(t *testing.T, pool *pgxpool.Pool, tables []string, want bool) {
	t.Helper()
	for _, table := range tables {
		var oid *string
		err := pool.QueryRow(context.Background(), `SELECT to_regclass($1)::text`, table).Scan(&oid)
		if err != nil {
			t.Fatalf("look up table %s: %v", table, err)
		}
		if got := oid != nil; got != want {
			t.Errorf("table %s exists = %t, want %t", table, got, want)
		}
	}
}

func TestNewPool_unreachable(t *testing.T) {
	// Nothing listens on port 1, so this needs no container.
	_, err := db.NewPool(context.Background(), "postgres://u:p@127.0.0.1:1/db?sslmode=disable&connect_timeout=1")
	if err == nil {
		t.Fatal("NewPool() succeeded against an unreachable database")
	}
}
