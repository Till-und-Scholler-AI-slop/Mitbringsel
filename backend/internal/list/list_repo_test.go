package list

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"mitbringsel/internal/group"
	"mitbringsel/internal/platform/db/dbtest"
	"mitbringsel/internal/platform/db/sqlcgen"
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
// subtest creates its own users and groups. The service runs on the real
// group repository, so membership is checked against the database, too.
func TestPostgresRepository(t *testing.T) {
	pool := dbtest.NewPool(t)
	groupRepo := group.NewPostgresRepository(pool)
	groups := group.NewService(groupRepo, nil)
	repo := NewPostgresRepository(sqlcgen.New(pool))
	svc := NewService(repo, groupRepo, nil)
	ctx := context.Background()

	newGroup := func(t *testing.T, owner uuid.UUID) uuid.UUID {
		t.Helper()
		g, err := groups.Create(ctx, owner, "WG")
		if err != nil {
			t.Fatalf("create group: %v", err)
		}
		return g.ID
	}

	t.Run("create, get and list oldest first", func(t *testing.T) {
		anna := newTestUser(t, pool, "create-anna")
		groupID := newGroup(t, anna)

		first, err := svc.Create(ctx, anna, groupID, "Supermarkt")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if first.ID == uuid.Nil || first.GroupID != groupID || first.CreatedAt.IsZero() || first.ServerSeq == 0 || first.Archived() {
			t.Errorf("Create() = %+v, want ID, group, timestamps, server_seq and no archive date", first)
		}
		second, err := svc.Create(ctx, anna, groupID, "Baumarkt")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if second.ServerSeq <= first.ServerSeq {
			t.Errorf("server_seq = %d after %d, want it to grow", second.ServerSeq, first.ServerSeq)
		}

		got, err := svc.Get(ctx, anna, first.ID)
		if err != nil || got.ID != first.ID || got.Name != "Supermarkt" {
			t.Errorf("Get() = %+v, %v, want the first list", got, err)
		}
		lists, err := svc.ListForGroup(ctx, anna, groupID, false)
		if err != nil {
			t.Fatalf("ListForGroup() error = %v", err)
		}
		if len(lists) != 2 || lists[0].ID != first.ID || lists[1].ID != second.ID {
			t.Errorf("ListForGroup() = %+v, want first then second", lists)
		}
	})

	t.Run("lists stay inside their group", func(t *testing.T) {
		anna := newTestUser(t, pool, "scope-anna")
		ben := newTestUser(t, pool, "scope-ben")
		annasGroup, bensGroup := newGroup(t, anna), newGroup(t, ben)

		annasList, err := svc.Create(ctx, anna, annasGroup, "Annas Liste")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if _, err := svc.Create(ctx, ben, bensGroup, "Bens Liste"); err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		lists, err := svc.ListForGroup(ctx, anna, annasGroup, true)
		if err != nil || len(lists) != 1 || lists[0].ID != annasList.ID {
			t.Errorf("ListForGroup() = %+v, %v, want only Annas list", lists, err)
		}
		if _, err := svc.Get(ctx, ben, annasList.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() by a member of another group error = %v, want %v", err, ErrNotFound)
		}
		if _, err := svc.Create(ctx, ben, annasGroup, "Eingeschleust"); !errors.Is(err, ErrNotFound) {
			t.Errorf("Create() in another group error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("rename draws a new server_seq and updates the timestamp", func(t *testing.T) {
		anna := newTestUser(t, pool, "rename-anna")
		groupID := newGroup(t, anna)
		created, err := svc.Create(ctx, anna, groupID, "Old")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		renamed, err := svc.Rename(ctx, anna, created.ID, "New")
		if err != nil {
			t.Fatalf("Rename() error = %v", err)
		}
		if renamed.Name != "New" || renamed.ServerSeq <= created.ServerSeq || !renamed.UpdatedAt.After(created.UpdatedAt) {
			t.Errorf("Rename() = %+v, want new name, larger server_seq and later updated_at than %+v", renamed, created)
		}
		if !renamed.CreatedAt.Equal(created.CreatedAt) {
			t.Errorf("created_at changed from %v to %v", created.CreatedAt, renamed.CreatedAt)
		}

		// The same name again is no change: no write, so no new server_seq.
		same, err := svc.Rename(ctx, anna, created.ID, "New")
		if err != nil || same.ServerSeq != renamed.ServerSeq || !same.UpdatedAt.Equal(renamed.UpdatedAt) {
			t.Errorf("second Rename() = %+v, %v, want %+v unchanged", same, err, renamed)
		}
	})

	t.Run("archive hides a list and keeps the first archive date", func(t *testing.T) {
		anna := newTestUser(t, pool, "archive-anna")
		groupID := newGroup(t, anna)
		l, err := svc.Create(ctx, anna, groupID, "Supermarkt")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		archived, err := svc.Archive(ctx, anna, l.ID)
		if err != nil || !archived.Archived() || archived.ServerSeq <= l.ServerSeq {
			t.Fatalf("Archive() = %+v, %v, want an archived list with a larger server_seq", archived, err)
		}
		again, err := svc.Archive(ctx, anna, l.ID)
		if err != nil || again.ArchivedAt == nil || !again.ArchivedAt.Equal(*archived.ArchivedAt) {
			t.Errorf("second Archive() = %+v, %v, want the first archive date %v", again, err, archived.ArchivedAt)
		}
		if again.ServerSeq != archived.ServerSeq {
			t.Errorf("second Archive() drew server_seq %d, want the unchanged %d", again.ServerSeq, archived.ServerSeq)
		}

		active, err := svc.ListForGroup(ctx, anna, groupID, false)
		if err != nil || len(active) != 0 {
			t.Errorf("ListForGroup(false) = %+v, %v, want no lists", active, err)
		}
		all, err := svc.ListForGroup(ctx, anna, groupID, true)
		if err != nil || len(all) != 1 {
			t.Errorf("ListForGroup(true) = %+v, %v, want the archived list", all, err)
		}

		restored, err := svc.Unarchive(ctx, anna, l.ID)
		if err != nil || restored.Archived() {
			t.Errorf("Unarchive() = %+v, %v, want an active list", restored, err)
		}
	})

	t.Run("delete takes the items along, admins may, members may not", func(t *testing.T) {
		anna := newTestUser(t, pool, "delete-anna")
		ben := newTestUser(t, pool, "delete-ben")
		cleo := newTestUser(t, pool, "delete-cleo")
		groupID := newGroup(t, anna)
		if err := groupRepo.AddMember(ctx, groupID, ben, group.RoleMember); err != nil {
			t.Fatalf("AddMember() error = %v", err)
		}
		if err := groupRepo.AddMember(ctx, groupID, cleo, group.RoleAdmin); err != nil {
			t.Fatalf("AddMember() error = %v", err)
		}
		l, err := svc.Create(ctx, ben, groupID, "Supermarkt")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		itemID := uuid.New()
		if _, err := pool.Exec(ctx, `INSERT INTO items (id, list_id, name) VALUES ($1, $2, 'Milch')`, itemID, l.ID); err != nil {
			t.Fatalf("insert item: %v", err)
		}

		if err := svc.Delete(ctx, ben, l.ID); !errors.Is(err, ErrForbidden) {
			t.Fatalf("Delete() by member error = %v, want %v", err, ErrForbidden)
		}
		if err := svc.Delete(ctx, cleo, l.ID); err != nil {
			t.Fatalf("Delete() by admin error = %v", err)
		}

		if _, err := svc.Get(ctx, anna, l.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() after Delete() error = %v, want %v", err, ErrNotFound)
		}
		var items int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM items WHERE id = $1`, itemID).Scan(&items); err != nil {
			t.Fatalf("count items: %v", err)
		}
		if items != 0 {
			t.Errorf("%d items left after deleting the list, want 0", items)
		}
		if err := svc.Delete(ctx, anna, l.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("second Delete() error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("deleting the group takes the lists along", func(t *testing.T) {
		anna := newTestUser(t, pool, "cascade-anna")
		groupID := newGroup(t, anna)
		l, err := svc.Create(ctx, anna, groupID, "Supermarkt")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if err := groups.Delete(ctx, anna, groupID); err != nil {
			t.Fatalf("delete group: %v", err)
		}
		if _, err := repo.Get(ctx, l.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() after deleting the group error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("names over the limit are refused by the database too", func(t *testing.T) {
		anna := newTestUser(t, pool, "limit-anna")
		groupID := newGroup(t, anna)
		// The repository skips the service's checks on purpose.
		if _, err := repo.Create(ctx, groupID, strings.Repeat("a", MaxNameLength+1)); err == nil {
			t.Error("Create() with a too long name succeeded, want a CHECK violation")
		}
		if _, err := repo.Create(ctx, groupID, ""); err == nil {
			t.Error("Create() with an empty name succeeded, want a CHECK violation")
		}
	})

	t.Run("unknown ids are not found", func(t *testing.T) {
		unknown := uuid.New()
		if _, err := repo.Get(ctx, unknown); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() error = %v, want %v", err, ErrNotFound)
		}
		if _, err := repo.Rename(ctx, unknown, "x"); !errors.Is(err, ErrNotFound) {
			t.Errorf("Rename() error = %v, want %v", err, ErrNotFound)
		}
		if _, err := repo.SetArchived(ctx, unknown, true); !errors.Is(err, ErrNotFound) {
			t.Errorf("SetArchived() error = %v, want %v", err, ErrNotFound)
		}
		if err := repo.Delete(ctx, unknown); !errors.Is(err, ErrNotFound) {
			t.Errorf("Delete() error = %v, want %v", err, ErrNotFound)
		}
	})
}
