package group

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"mitbringsel/internal/platform/db/dbtest"
	"mitbringsel/internal/platform/db/sqlcgen"
)

const (
	// How long the second transaction must stay blocked to count as waiting.
	lockWaitCheck = 300 * time.Millisecond
	// How long it may take to get through once the lock is released.
	lockReleaseTimeout = 5 * time.Second
)

// newTestUser stores a user and returns its ID. name keeps subjects unique
// across subtests that share one database.
func newTestUser(t *testing.T, pool *pgxpool.Pool, name string) uuid.UUID {
	t.Helper()
	u, err := sqlcgen.New(pool).UpsertUserByGoogleSub(context.Background(), sqlcgen.UpsertUserByGoogleSubParams{
		GoogleSub:   "test-" + name,
		Email:       name + "@example.com",
		DisplayName: name,
	})
	if err != nil {
		t.Fatalf("create user %s: %v", name, err)
	}
	return u.ID
}

// TestPostgresRepository shares one container across its subtests; each
// subtest creates its own users and groups.
func TestPostgresRepository(t *testing.T) {
	pool := dbtest.NewPool(t)
	repo := NewPostgresRepository(pool)
	svc := NewService(repo)
	ctx := context.Background()

	t.Run("create, list and get", func(t *testing.T) {
		anna := newTestUser(t, pool, "list-anna")
		ben := newTestUser(t, pool, "list-ben")

		created, err := svc.Create(ctx, anna, "WG Kaiserstraße")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if created.ID == uuid.Nil || created.CreatedAt.IsZero() {
			t.Errorf("Create() = %+v, want ID and timestamps", created)
		}
		if err := repo.AddMember(ctx, created.ID, ben, RoleMember); err != nil {
			t.Fatalf("AddMember() error = %v", err)
		}

		list, err := svc.List(ctx, ben)
		if err != nil {
			t.Fatalf("List() error = %v", err)
		}
		if len(list) != 1 || list[0].ID != created.ID || list[0].Role != RoleMember {
			t.Fatalf("List() = %+v, want the group with role member", list)
		}
		members := list[0].Members
		if len(members) != 2 || members[0].UserID != anna || members[0].Role != RoleOwner ||
			members[0].DisplayName != "list-anna" || members[1].UserID != ben {
			t.Errorf("Members = %+v, want anna (owner) then ben", members)
		}

		if _, err := svc.Get(ctx, newTestUser(t, pool, "list-outsider"), created.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() by outsider error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("rename updates the timestamp", func(t *testing.T) {
		anna := newTestUser(t, pool, "rename-anna")
		created, err := svc.Create(ctx, anna, "Old")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		renamed, err := svc.Rename(ctx, anna, created.ID, "New")
		if err != nil {
			t.Fatalf("Rename() error = %v", err)
		}
		if renamed.Name != "New" || !renamed.UpdatedAt.After(created.UpdatedAt) {
			t.Errorf("Rename() = %+v, want new name and later UpdatedAt than %v", renamed, created.UpdatedAt)
		}
	})

	t.Run("delete takes the members with it", func(t *testing.T) {
		anna := newTestUser(t, pool, "delete-anna")
		created, err := svc.Create(ctx, anna, "Gone soon")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		if err := svc.Delete(ctx, anna, created.ID); err != nil {
			t.Fatalf("Delete() error = %v", err)
		}

		var members int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM group_members WHERE group_id = $1`, created.ID).Scan(&members); err != nil {
			t.Fatalf("count members: %v", err)
		}
		if members != 0 {
			t.Errorf("%d members left after delete", members)
		}
		if err := repo.Delete(ctx, created.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("second Delete() error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("unknown rows are not found", func(t *testing.T) {
		unknown := uuid.New()
		if _, err := repo.Get(ctx, unknown); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() error = %v", err)
		}
		if err := repo.Lock(ctx, unknown); !errors.Is(err, ErrNotFound) {
			t.Errorf("Lock() error = %v", err)
		}
		if _, err := repo.MemberRole(ctx, unknown, unknown); !errors.Is(err, ErrNotFound) {
			t.Errorf("MemberRole() error = %v", err)
		}
		if err := repo.RemoveMember(ctx, unknown, unknown); !errors.Is(err, ErrNotFound) {
			t.Errorf("RemoveMember() error = %v", err)
		}
		if err := repo.SetRole(ctx, unknown, unknown, RoleOwner); !errors.Is(err, ErrNotFound) {
			t.Errorf("SetRole() error = %v", err)
		}
	})

	t.Run("failed transaction stores nothing", func(t *testing.T) {
		anna := newTestUser(t, pool, "tx-anna")
		var groupID uuid.UUID

		err := repo.InTx(ctx, func(tx Repository) error {
			g, err := tx.Create(ctx, "Rolled back", anna)
			if err != nil {
				return err
			}
			groupID = g.ID
			return errRepo
		})

		if !errors.Is(err, errRepo) {
			t.Fatalf("InTx() error = %v, want %v", err, errRepo)
		}
		if _, err := repo.Get(ctx, groupID); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() after rollback error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("names over the limit are refused by the database too", func(t *testing.T) {
		anna := newTestUser(t, pool, "limit-anna")
		long := make([]rune, MaxNameLength+1)
		for i := range long {
			long[i] = 'ß'
		}
		if _, err := repo.Create(ctx, string(long), anna); err == nil {
			t.Error("Create() with a too long name succeeded")
		}
	})

	// The mechanism behind the last-owner rule: while one transaction holds
	// the lock, a second one locking the same group must wait.
	t.Run("lock makes a second transaction wait", func(t *testing.T) {
		anna := newTestUser(t, pool, "lock-anna")
		created, err := svc.Create(ctx, anna, "Locked")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		locked := make(chan struct{})
		release := make(chan struct{})
		// Released on every way out, also when a check below fails: an open
		// transaction would otherwise keep the test from ever finishing.
		releaseFirst := sync.OnceFunc(func() { close(release) })
		defer releaseFirst()
		firstDone := make(chan error, 1)
		go func() {
			firstDone <- repo.InTx(ctx, func(tx Repository) error {
				if err := tx.Lock(ctx, created.ID); err != nil {
					return err
				}
				close(locked)
				<-release
				return nil
			})
		}()
		<-locked

		secondDone := make(chan error, 1)
		go func() {
			secondDone <- repo.InTx(ctx, func(tx Repository) error {
				return tx.Lock(ctx, created.ID)
			})
		}()

		select {
		case err := <-secondDone:
			t.Fatalf("second lock did not wait (error = %v)", err)
		case <-time.After(lockWaitCheck):
		}

		releaseFirst()
		for name, done := range map[string]chan error{"first": firstDone, "second": secondDone} {
			select {
			case err := <-done:
				if err != nil {
					t.Errorf("%s transaction error = %v", name, err)
				}
			case <-time.After(lockReleaseTimeout):
				t.Fatalf("%s transaction did not finish", name)
			}
		}
	})

	// The rule end to end. Without the lock this would only fail when both
	// transactions happen to overlap, so the test above checks the lock
	// itself; this one checks the outcome.
	t.Run("two owners leaving at once keep one owner", func(t *testing.T) {
		anna := newTestUser(t, pool, "race-anna")
		ben := newTestUser(t, pool, "race-ben")
		created, err := svc.Create(ctx, anna, "Race")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if err := repo.AddMember(ctx, created.ID, ben, RoleOwner); err != nil {
			t.Fatalf("AddMember() error = %v", err)
		}

		var wg sync.WaitGroup
		errs := make([]error, 2)
		for i, user := range []uuid.UUID{anna, ben} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				errs[i] = svc.RemoveMember(ctx, user, created.ID, user)
			}()
		}
		wg.Wait()

		succeeded, lastOwner := 0, 0
		for _, err := range errs {
			switch {
			case err == nil:
				succeeded++
			case errors.Is(err, ErrLastOwner):
				lastOwner++
			default:
				t.Errorf("RemoveMember() error = %v", err)
			}
		}
		if succeeded != 1 || lastOwner != 1 {
			t.Errorf("succeeded = %d, last owner errors = %d; want 1 and 1", succeeded, lastOwner)
		}
		owners, err := repo.CountOwners(ctx, created.ID)
		if err != nil || owners != 1 {
			t.Errorf("CountOwners() = %d, %v; want 1", owners, err)
		}
	})
}
