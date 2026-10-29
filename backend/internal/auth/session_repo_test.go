package auth

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"mitbringsel/internal/platform/db/dbtest"
	"mitbringsel/internal/platform/db/sqlcgen"
)

// TestPostgresSessionRepository shares one container across its subtests,
// because starting PostgreSQL takes seconds. Each subtest creates its own
// user, so the subtests stay independent of each other.
func TestPostgresSessionRepository(t *testing.T) {
	pool := dbtest.NewPool(t)
	queries := sqlcgen.New(pool)
	repo := NewPostgresSessionRepository(queries)
	ctx := context.Background()

	t.Run("create and get", func(t *testing.T) {
		want := newStoredSession(t, queries, "create-get")
		if err := repo.Create(ctx, want); err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		got, err := repo.Get(ctx, want.IDHash)
		if err != nil {
			t.Fatalf("Get() error = %v", err)
		}
		assertSessionEqual(t, got, want)
	})

	t.Run("get unknown hash", func(t *testing.T) {
		_, err := repo.Get(ctx, hashToken("NEVER-STORED"))
		if !errors.Is(err, ErrSessionNotFound) {
			t.Errorf("Get() error = %v, want %v", err, ErrSessionNotFound)
		}
	})

	t.Run("touch", func(t *testing.T) {
		s := newStoredSession(t, queries, "touch")
		if err := repo.Create(ctx, s); err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		s.LastSeenAt = s.LastSeenAt.Add(touchInterval)
		s.ExpiresAt = s.LastSeenAt.Add(sessionLifetime)
		if err := repo.Touch(ctx, s.IDHash, s.LastSeenAt, s.ExpiresAt); err != nil {
			t.Fatalf("Touch() error = %v", err)
		}

		got, err := repo.Get(ctx, s.IDHash)
		if err != nil {
			t.Fatalf("Get() error = %v", err)
		}
		assertSessionEqual(t, got, s)
	})

	t.Run("delete", func(t *testing.T) {
		s := newStoredSession(t, queries, "delete")
		if err := repo.Create(ctx, s); err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		if err := repo.Delete(ctx, s.IDHash); err != nil {
			t.Fatalf("Delete() error = %v", err)
		}
		if _, err := repo.Get(ctx, s.IDHash); !errors.Is(err, ErrSessionNotFound) {
			t.Errorf("Get() after Delete() error = %v, want %v", err, ErrSessionNotFound)
		}
	})

	t.Run("delete unknown hash", func(t *testing.T) {
		if err := repo.Delete(ctx, hashToken("NEVER-STORED")); err != nil {
			t.Errorf("Delete() error = %v, want nil", err)
		}
	})

	t.Run("unknown user is rejected", func(t *testing.T) {
		s := newStoredSession(t, queries, "unknown-user")
		s.UserID = uuid.New()
		if err := repo.Create(ctx, s); err == nil {
			t.Error("Create() succeeded for a user that does not exist")
		}
	})

	t.Run("deleting the user deletes their sessions", func(t *testing.T) {
		s := newStoredSession(t, queries, "cascade")
		if err := repo.Create(ctx, s); err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		deleteUser(t, pool, s.UserID)

		if _, err := repo.Get(ctx, s.IDHash); !errors.Is(err, ErrSessionNotFound) {
			t.Errorf("Get() after user deletion error = %v, want %v", err, ErrSessionNotFound)
		}
	})

	// The unit tests run the service against a fake; this runs it once
	// against the real repository to show both behave the same.
	t.Run("service end to end", func(t *testing.T) {
		userID := createUser(t, queries, "service")
		svc := NewSessionService(repo)

		token, _, err := svc.Create(ctx, userID)
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		got, _, err := svc.Validate(ctx, token)
		if err != nil {
			t.Fatalf("Validate() error = %v", err)
		}
		if got != userID {
			t.Errorf("Validate() = %v, want %v", got, userID)
		}

		if err := svc.Delete(ctx, token); err != nil {
			t.Fatalf("Delete() error = %v", err)
		}
		if _, _, err := svc.Validate(ctx, token); !errors.Is(err, ErrSessionNotFound) {
			t.Errorf("Validate() after Delete() error = %v, want %v", err, ErrSessionNotFound)
		}
	})
}

// createUser inserts a user with a fake Google ID. name keeps the IDs of the
// subtests apart, because google_sub is unique.
func createUser(t *testing.T, q *sqlcgen.Queries, name string) uuid.UUID {
	t.Helper()
	user, err := q.UpsertUserByGoogleSub(context.Background(), sqlcgen.UpsertUserByGoogleSubParams{
		GoogleSub:   "test-" + name,
		Email:       name + "@example.com",
		DisplayName: name,
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	return user.ID
}

// newStoredSession returns a session for a freshly created user. testStart
// has no sub-microsecond part, so it survives PostgreSQL's microsecond
// precision unchanged.
func newStoredSession(t *testing.T, q *sqlcgen.Queries, name string) Session {
	t.Helper()
	return Session{
		IDHash:     hashToken("token-" + name),
		UserID:     createUser(t, q, name),
		ExpiresAt:  testStart.Add(sessionLifetime),
		LastSeenAt: testStart,
	}
}

// deleteUser uses raw SQL because the app has no user deletion query yet.
func deleteUser(t *testing.T, pool *pgxpool.Pool, id uuid.UUID) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, id); err != nil {
		t.Fatalf("delete user: %v", err)
	}
}

// assertSessionEqual compares field by field: time.Time needs Equal, because
// PostgreSQL returns the same instant in a different time zone than UTC.
func assertSessionEqual(t *testing.T, got, want Session) {
	t.Helper()
	if !bytes.Equal(got.IDHash, want.IDHash) {
		t.Errorf("IDHash = %x, want %x", got.IDHash, want.IDHash)
	}
	if got.UserID != want.UserID {
		t.Errorf("UserID = %v, want %v", got.UserID, want.UserID)
	}
	if !got.ExpiresAt.Equal(want.ExpiresAt) {
		t.Errorf("ExpiresAt = %v, want %v", got.ExpiresAt, want.ExpiresAt)
	}
	if !got.LastSeenAt.Equal(want.LastSeenAt) {
		t.Errorf("LastSeenAt = %v, want %v", got.LastSeenAt, want.LastSeenAt)
	}
}
