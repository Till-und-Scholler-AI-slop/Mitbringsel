package group

import (
	"context"
	"errors"
	"slices"
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

// storedStatePublisher looks at the database, over a connection of its own,
// at the moment the service publishes. A publish before the commit would
// still see the old state there.
type storedStatePublisher struct {
	repo *PostgresRepository

	mu sync.Mutex
	// seen has one entry per event: what the database showed about the
	// member (or the group) it is about, e.g. "joined: owner".
	seen []string
}

func (p *storedStatePublisher) GroupChanged(context.Context, uuid.UUID, uuid.UUID) {}

func (p *storedStatePublisher) MemberJoined(ctx context.Context, groupID, userID uuid.UUID) {
	p.recordRole(ctx, "joined", groupID, userID)
}

func (p *storedStatePublisher) MemberRemoved(ctx context.Context, groupID, _, userID uuid.UUID) {
	p.recordRole(ctx, "removed", groupID, userID)
}

func (p *storedStatePublisher) GroupDeleted(ctx context.Context, groupID, _ uuid.UUID) {
	_, err := p.repo.Get(ctx, groupID)
	p.record("deleted: " + describe(err))
}

func (p *storedStatePublisher) recordRole(ctx context.Context, kind string, groupID, userID uuid.UUID) {
	role, err := p.repo.MemberRole(ctx, groupID, userID)
	if err != nil {
		p.record(kind + ": " + describe(err))
		return
	}
	p.record(kind + ": " + string(role))
}

func (p *storedStatePublisher) record(s string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.seen = append(p.seen, s)
}

// describe names what a lookup returned, so a failed read does not look like
// a missing row.
func describe(err error) string {
	switch {
	case err == nil:
		return "found"
	case errors.Is(err, ErrNotFound):
		return "not found"
	default:
		return "error " + err.Error()
	}
}

// TestPostgresRepository shares one container across its subtests; each
// subtest creates its own users and groups.
func TestPostgresRepository(t *testing.T) {
	pool := dbtest.NewPool(t)
	repo := NewPostgresRepository(pool)
	svc := NewService(repo, nil)
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

	t.Run("count owned counts only the groups the user owns", func(t *testing.T) {
		anna := newTestUser(t, pool, "count-anna")
		ben := newTestUser(t, pool, "count-ben")
		for _, name := range []string{"Zuhause", "Ferienhaus"} {
			if _, err := svc.Create(ctx, anna, name); err != nil {
				t.Fatalf("Create() error = %v", err)
			}
		}
		bens, err := svc.Create(ctx, ben, "Bei Ben")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if err := repo.AddMember(ctx, bens.ID, anna, RoleAdmin); err != nil {
			t.Fatalf("AddMember() error = %v", err)
		}

		if got, err := repo.CountOwned(ctx, anna); err != nil || got != 2 {
			t.Errorf("CountOwned(anna) = %d, %v, want 2", got, err)
		}
		if got, err := repo.CountOwned(ctx, ben); err != nil || got != 1 {
			t.Errorf("CountOwned(ben) = %d, %v, want 1", got, err)
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
		if err := repo.SetRole(ctx, unknown, unknown, RoleAdmin); !errors.Is(err, ErrNotFound) {
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

	// The mechanism behind the membership rules: while one transaction holds
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

	t.Run("the database allows only one owner per group", func(t *testing.T) {
		anna := newTestUser(t, pool, "owner-anna")
		ben := newTestUser(t, pool, "owner-ben")
		created, err := svc.Create(ctx, anna, "Owned")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		if err := repo.AddMember(ctx, created.ID, ben, RoleOwner); err == nil {
			t.Error("AddMember() made a second owner")
		}
		if err := repo.AddMember(ctx, created.ID, ben, RoleAdmin); err != nil {
			t.Fatalf("AddMember() as admin error = %v", err)
		}
		if err := repo.SetRole(ctx, created.ID, ben, RoleOwner); err == nil {
			t.Error("SetRole() made a second owner")
		}
		if err := repo.AddMember(ctx, created.ID, newTestUser(t, pool, "owner-cem"), Role("boss")); err == nil {
			t.Error("AddMember() accepted an unknown role")
		}

		// A second group has its own owner.
		if _, err := svc.Create(ctx, ben, "Also owned"); err != nil {
			t.Errorf("Create() for another group error = %v", err)
		}
	})

	t.Run("invites go with their group, not with their creator", func(t *testing.T) {
		anna := newTestUser(t, pool, "invite-anna")
		created, err := svc.Create(ctx, anna, "Invited")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		hash := make([]byte, 32)
		hash[0] = 1
		insert := `INSERT INTO group_invites (group_id, token_hash, created_by, expires_at)
			VALUES ($1, $2, $3, now() + interval '7 days')`

		if _, err := pool.Exec(ctx, insert, created.ID, hash, anna); err != nil {
			t.Fatalf("insert invite: %v", err)
		}
		if _, err := pool.Exec(ctx, insert, created.ID, hash, anna); err == nil {
			t.Error("two invites with the same token hash were stored")
		}
		if _, err := pool.Exec(ctx, insert, created.ID, []byte("short"), anna); err == nil {
			t.Error("a token hash with the wrong length was stored")
		}

		// Deleting the creator's account keeps the invite, without a creator.
		if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, anna); err != nil {
			t.Fatalf("delete user: %v", err)
		}
		var creatorIsNull bool
		err = pool.QueryRow(ctx, `SELECT created_by IS NULL FROM group_invites WHERE group_id = $1`, created.ID).Scan(&creatorIsNull)
		if err != nil || !creatorIsNull {
			t.Errorf("created_by IS NULL = %v, %v; want true", creatorIsNull, err)
		}

		if _, err := pool.Exec(ctx, `DELETE FROM groups WHERE id = $1`, created.ID); err != nil {
			t.Fatalf("delete group: %v", err)
		}
		var invites int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM group_invites WHERE group_id = $1`, created.ID).Scan(&invites); err != nil {
			t.Fatalf("count invites: %v", err)
		}
		if invites != 0 {
			t.Errorf("%d invites left after the group was deleted", invites)
		}
	})

	t.Run("delete stale invites keeps active and recent ones", func(t *testing.T) {
		anna := newTestUser(t, pool, "stale-anna")
		created, err := svc.Create(ctx, anna, "Stale")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		// Long before the invites of the other subtests (made with now()),
		// so the count below only sees the invites made here.
		cutoff := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
		before, after := cutoff.Add(-time.Hour), cutoff.Add(time.Hour)
		cases := []struct {
			name      string
			expiresAt time.Time
			revokedAt *time.Time
			wantGone  bool
		}{
			{"expired before the cutoff", before, nil, true},
			{"revoked before the cutoff, expiring later", after, &before, true},
			{"expired exactly at the cutoff", cutoff, nil, false},
			{"still valid", after, nil, false},
			{"revoked after the cutoff", after, &after, false},
		}
		ids := make([]uuid.UUID, len(cases))
		for i, c := range cases {
			hash := make([]byte, 32)
			hash[0], hash[1] = 2, byte(i)
			err := pool.QueryRow(ctx, `INSERT INTO group_invites (group_id, token_hash, created_by, expires_at, revoked_at)
				VALUES ($1, $2, $3, $4, $5) RETURNING id`, created.ID, hash, anna, c.expiresAt, c.revokedAt).Scan(&ids[i])
			if err != nil {
				t.Fatalf("insert invite %q: %v", c.name, err)
			}
		}

		n, err := repo.DeleteStaleInvites(ctx, cutoff)
		if err != nil {
			t.Fatalf("DeleteStaleInvites() error = %v", err)
		}
		if n != 2 {
			t.Errorf("DeleteStaleInvites() = %d, want 2", n)
		}
		for i, c := range cases {
			var left bool
			if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM group_invites WHERE id = $1)`, ids[i]).Scan(&left); err != nil {
				t.Fatalf("look up invite %q: %v", c.name, err)
			}
			if left == c.wantGone {
				t.Errorf("invite %q still there = %v, want %v", c.name, left, !c.wantGone)
			}
		}
	})

	t.Run("publishes only after the commit", func(t *testing.T) {
		anna := newTestUser(t, pool, "publish-anna")
		ben := newTestUser(t, pool, "publish-ben")
		pub := &storedStatePublisher{repo: NewPostgresRepository(pool)}
		pubSvc := NewService(repo, pub)
		pubInvites := NewInviteService(repo, pub)

		created, err := pubSvc.Create(ctx, anna, "Publish")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		token, _, err := pubInvites.Create(ctx, anna, created.ID)
		if err != nil {
			t.Fatalf("invite Create() error = %v", err)
		}
		if _, err := pubInvites.Accept(ctx, ben, token); err != nil {
			t.Fatalf("Accept() error = %v", err)
		}
		if err := pubSvc.RemoveMember(ctx, anna, created.ID, ben); err != nil {
			t.Fatalf("RemoveMember() error = %v", err)
		}
		if err := pubSvc.Delete(ctx, anna, created.ID); err != nil {
			t.Fatalf("Delete() error = %v", err)
		}

		pub.mu.Lock()
		defer pub.mu.Unlock()
		want := []string{"joined: owner", "joined: member", "removed: not found", "deleted: not found"}
		if !slices.Equal(pub.seen, want) {
			t.Errorf("database state at publishing = %q, want %q", pub.seen, want)
		}
	})

	t.Run("AddMemberIfAbsent reports whether it added someone", func(t *testing.T) {
		anna := newTestUser(t, pool, "absent-anna")
		ben := newTestUser(t, pool, "absent-ben")
		created, err := svc.Create(ctx, anna, "Absent")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		// The first call adds, the second finds Ben and keeps his role.
		for i, want := range []bool{true, false} {
			added, err := repo.AddMemberIfAbsent(ctx, created.ID, ben, RoleMember)
			if err != nil || added != want {
				t.Fatalf("AddMemberIfAbsent() call %d = %v, %v; want %v", i+1, added, err, want)
			}
		}
		// A member who has a higher role already is not added, nor demoted.
		if added, err := repo.AddMemberIfAbsent(ctx, created.ID, anna, RoleMember); err != nil || added {
			t.Errorf("AddMemberIfAbsent() for the owner = %v, %v; want false", added, err)
		}
		if role, _ := repo.MemberRole(ctx, created.ID, anna); role != RoleOwner {
			t.Errorf("owner role after AddMemberIfAbsent() = %q, want %q", role, RoleOwner)
		}
	})

	// The invite service on the real repository: hashing, expiry in SQL,
	// the group scope of revoke and the idempotent join.
	t.Run("invites end to end", func(t *testing.T) {
		anna := newTestUser(t, pool, "inv-anna")
		ben := newTestUser(t, pool, "inv-ben")
		cem := newTestUser(t, pool, "inv-cem")
		created, err := svc.Create(ctx, anna, "Invites")
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		other, err := svc.Create(ctx, ben, "Elsewhere")
		if err != nil {
			t.Fatalf("Create() other error = %v", err)
		}
		invites := NewInviteService(repo, nil)

		token, invite, err := invites.Create(ctx, anna, created.ID)
		if err != nil {
			t.Fatalf("invite Create() error = %v", err)
		}
		if invite.CreatedByName != "inv-anna" {
			t.Errorf("CreatedByName = %q, want the creator", invite.CreatedByName)
		}

		listed, err := invites.List(ctx, anna, created.ID)
		if err != nil || len(listed) != 1 || listed[0].ID != invite.ID {
			t.Fatalf("List() = %+v, %v; want the new invite", listed, err)
		}

		preview, err := invites.Preview(ctx, token)
		if err != nil || preview.GroupName != "Invites" || preview.InvitedBy != "inv-anna" {
			t.Fatalf("Preview() = %+v, %v", preview, err)
		}
		if preview.MemberCount != 1 || len(preview.Members) != 1 || preview.Members[0].FirstName != "inv-anna" {
			t.Errorf("Preview() members = %d counted, %+v; want only the owner", preview.MemberCount, preview.Members)
		}

		// Joining twice, and as the owner, leaves exactly one membership.
		for _, user := range []uuid.UUID{ben, ben, anna} {
			if _, err := invites.Accept(ctx, user, token); err != nil {
				t.Fatalf("Accept() error = %v", err)
			}
		}
		if role, _ := repo.MemberRole(ctx, created.ID, ben); role != RoleMember {
			t.Errorf("joined role = %q, want %q", role, RoleMember)
		}
		if role, _ := repo.MemberRole(ctx, created.ID, anna); role != RoleOwner {
			t.Errorf("owner role after accepting = %q, want %q", role, RoleOwner)
		}

		if preview, _ := invites.Preview(ctx, token); preview.MemberCount != 2 {
			t.Errorf("Preview() MemberCount after Ben joined = %d, want 2", preview.MemberCount)
		}

		// Ben is in another group as owner and here as member: he cannot
		// revoke, and the owner of the other group cannot reach this invite.
		if err := invites.Revoke(ctx, ben, other.ID, invite.ID); !errors.Is(err, ErrInviteNotFound) {
			t.Errorf("Revoke() through another group error = %v, want %v", err, ErrInviteNotFound)
		}
		if err := invites.Revoke(ctx, anna, created.ID, invite.ID); err != nil {
			t.Fatalf("Revoke() error = %v", err)
		}
		if _, err := invites.Accept(ctx, cem, token); !errors.Is(err, ErrInviteExpired) {
			t.Errorf("Accept() after revoke error = %v, want %v", err, ErrInviteExpired)
		}
		if _, err := invites.Accept(ctx, cem, "unknown"); !errors.Is(err, ErrInviteNotFound) {
			t.Errorf("Accept() unknown token error = %v, want %v", err, ErrInviteNotFound)
		}
		if _, err := repo.MemberRole(ctx, created.ID, cem); !errors.Is(err, ErrNotFound) {
			t.Errorf("cem joined with a revoked or unknown token (error = %v)", err)
		}
		if listed, _ := invites.List(ctx, anna, created.ID); len(listed) != 0 {
			t.Errorf("List() after revoke = %+v, want none", listed)
		}

		// Expiry is decided in SQL against the service's clock.
		later := NewInviteService(repo, nil)
		later.now = func() time.Time { return time.Now().Add(8 * 24 * time.Hour) }
		fresh, _, err := invites.Create(ctx, anna, created.ID)
		if err != nil {
			t.Fatalf("second Create() error = %v", err)
		}
		if _, err := later.Preview(ctx, fresh); !errors.Is(err, ErrInviteExpired) {
			t.Errorf("Preview() after 8 days error = %v, want %v", err, ErrInviteExpired)
		}
		if listed, _ := later.List(ctx, anna, created.ID); len(listed) != 0 {
			t.Errorf("List() after 8 days = %+v, want none", listed)
		}
	})
}
