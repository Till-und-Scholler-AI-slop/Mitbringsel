package seed

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"mitbringsel/internal/auth"
	"mitbringsel/internal/group"
	"mitbringsel/internal/item"
	"mitbringsel/internal/platform/db/dbtest"
	"mitbringsel/internal/platform/db/sqlcgen"
	"mitbringsel/internal/user"
)

const (
	wantActiveLists   = 4
	wantArchivedLists = 1
	wantActiveItems   = 40
)

// TestRun runs the seed twice on one database and checks the second run
// against the promises of docs/testing.md: the same users and sessions, the
// seed groups replaced instead of duplicated, foreign data untouched.
func TestRun(t *testing.T) {
	pool := dbtest.NewPool(t)
	ctx := context.Background()
	queries := sqlcgen.New(pool)

	s, err := newSeeder(pool)
	if err != nil {
		t.Fatalf("newSeeder() error = %v", err)
	}

	// Data of someone else, which the seed must not touch.
	outsider, err := queries.UpsertUserByGoogleSub(ctx, sqlcgen.UpsertUserByGoogleSubParams{
		GoogleSub:   "test-outsider",
		Email:       "outsider@example.com",
		DisplayName: "Outsider",
		NameGiven:   true,
	})
	if err != nil {
		t.Fatalf("create outsider: %v", err)
	}
	foreign, err := s.groups.Create(ctx, outsider.ID, "Foreign group")
	if err != nil {
		t.Fatalf("create foreign group: %v", err)
	}

	first, err := Run(ctx, pool)
	if err != nil {
		t.Fatalf("first Run() error = %v", err)
	}
	userIDs := make(map[string]uuid.UUID)
	for _, u := range first.Users {
		userIDs[u.Email] = u.ID
	}

	// A session that was open before the second run, as in a browser tab.
	sessions := auth.NewSessionService(auth.NewPostgresSessionRepository(queries))
	token, _, err := sessions.Create(ctx, userIDs[emailAnna])
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	second, err := Run(ctx, pool)
	if err != nil {
		t.Fatalf("second Run() error = %v", err)
	}

	t.Run("users keep their IDs", func(t *testing.T) {
		if len(second.Users) != len(userSpecs) {
			t.Fatalf("Run() returned %d users, want %d", len(second.Users), len(userSpecs))
		}
		for _, u := range second.Users {
			if u.ID != userIDs[u.Email] {
				t.Errorf("ID of %s = %v, want %v", u.Email, u.ID, userIDs[u.Email])
			}
		}

		var count int
		err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE google_sub LIKE 'dev:%'`).Scan(&count)
		if err != nil {
			t.Fatalf("count users: %v", err)
		}
		if count != len(userSpecs) {
			t.Errorf("%d dev users in database, want %d", count, len(userSpecs))
		}
	})

	t.Run("users can log in with the dev login", func(t *testing.T) {
		for _, spec := range userSpecs {
			var id uuid.UUID
			err := pool.QueryRow(ctx, `SELECT id FROM users WHERE google_sub = $1`, user.DevSubject(spec.Email)).Scan(&id)
			if err != nil {
				t.Fatalf("find %s by dev subject: %v", spec.Email, err)
			}
			if id != userIDs[spec.Email] {
				t.Errorf("dev subject of %s belongs to %v, want %v", spec.Email, id, userIDs[spec.Email])
			}
		}
	})

	t.Run("session survives", func(t *testing.T) {
		got, _, err := sessions.Validate(ctx, token)
		if err != nil {
			t.Fatalf("Validate() error = %v", err)
		}
		if got != userIDs[emailAnna] {
			t.Errorf("session user = %v, want %v", got, userIDs[emailAnna])
		}
	})

	t.Run("groups are replaced, not duplicated", func(t *testing.T) {
		// Per user: group name -> role.
		want := map[string]map[string]group.Role{
			emailAnna:  {"WG Kaiserstraße 12": group.RoleOwner, "Familie Müller-Lüdenscheidt": group.RoleMember},
			emailBen:   {"WG Kaiserstraße 12": group.RoleMember, "Familie Müller-Lüdenscheidt": group.RoleOwner},
			emailChloe: {"Familie Müller-Lüdenscheidt": group.RoleAdmin},
		}
		for email, wantRoles := range want {
			details, err := s.groups.List(ctx, userIDs[email])
			if err != nil {
				t.Fatalf("List groups of %s: %v", email, err)
			}
			got := make(map[string]group.Role)
			for _, d := range details {
				got[d.Name] = d.Role
			}
			if len(details) != len(wantRoles) {
				t.Errorf("%s is in %d groups, want %d", email, len(details), len(wantRoles))
			}
			for name, role := range wantRoles {
				if got[name] != role {
					t.Errorf("role of %s in %q = %q, want %q", email, name, got[name], role)
				}
			}
		}

		wantMembers := map[string]int{"WG Kaiserstraße 12": 2, "Familie Müller-Lüdenscheidt": 3}
		details, err := s.groups.List(ctx, userIDs[emailAnna])
		if err != nil {
			t.Fatalf("List groups of Anna: %v", err)
		}
		for _, d := range details {
			if len(d.Members) != wantMembers[d.Name] {
				t.Errorf("%q has %d members, want %d", d.Name, len(d.Members), wantMembers[d.Name])
			}
		}

		// 2 seed groups and the foreign one: nothing was left over.
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM groups`).Scan(&count); err != nil {
			t.Fatalf("count groups: %v", err)
		}
		if count != 3 {
			t.Errorf("%d groups in database, want 3", count)
		}
	})

	t.Run("foreign group is untouched", func(t *testing.T) {
		got, err := s.groups.Get(ctx, outsider.ID, foreign.ID)
		if err != nil {
			t.Fatalf("Get foreign group: %v", err)
		}
		if got.Name != "Foreign group" || got.Role != group.RoleOwner {
			t.Errorf("foreign group = %q as %q, want it unchanged", got.Name, got.Role)
		}
	})

	t.Run("no invite stays open", func(t *testing.T) {
		details, err := s.groups.List(ctx, userIDs[emailAnna])
		if err != nil {
			t.Fatalf("List groups of Anna: %v", err)
		}
		for _, d := range details {
			// Only owner and admins may list invites; Anna owns the WG, and
			// Ben (owner of the other group) is asked for that one.
			actor := userIDs[emailAnna]
			if d.Role != group.RoleOwner {
				actor = userIDs[emailBen]
			}
			invites, err := s.invites.List(ctx, actor, d.ID)
			if err != nil {
				t.Fatalf("List invites of %q: %v", d.Name, err)
			}
			if len(invites) != 0 {
				t.Errorf("%q has %d open invites, want none", d.Name, len(invites))
			}
		}
	})

	t.Run("lists and items", func(t *testing.T) {
		var active, archived, activeItems, archivedItems, checked int
		details, err := s.groups.List(ctx, userIDs[emailAnna])
		if err != nil {
			t.Fatalf("List groups of Anna: %v", err)
		}
		for _, d := range details {
			// Anna is a member of both groups, so she may read everything.
			lists, err := s.lists.ListForGroup(ctx, userIDs[emailAnna], d.ID, true)
			if err != nil {
				t.Fatalf("ListForGroup(%q): %v", d.Name, err)
			}
			for _, l := range lists {
				items, err := s.items.ListForList(ctx, userIDs[emailAnna], l.ID)
				if err != nil {
					t.Fatalf("ListForList(%q): %v", l.Name, err)
				}
				if l.Archived() {
					archived++
					archivedItems += len(items)
				} else {
					active++
					activeItems += len(items)
				}
				for _, it := range items {
					assertItem(t, it)
					if it.Checked {
						checked++
					}
				}
			}
		}

		if active != wantActiveLists {
			t.Errorf("%d active lists, want %d", active, wantActiveLists)
		}
		if archived != wantArchivedLists {
			t.Errorf("%d archived lists, want %d", archived, wantArchivedLists)
		}
		if activeItems != wantActiveItems {
			t.Errorf("%d items on active lists, want %d", activeItems, wantActiveItems)
		}
		if archivedItems == 0 {
			t.Error("archived list has no items")
		}
		if checked < 10 {
			t.Errorf("%d checked items, want at least 10", checked)
		}
	})
}

// assertItem checks what every seeded item must have, whatever its content:
// a clock for each field, a server_seq, and the checker if it is checked.
func assertItem(t *testing.T, it item.Item) {
	t.Helper()
	for _, f := range []item.Field{item.FieldName, item.FieldQuantity, item.FieldUnit, item.FieldNote, item.FieldChecked} {
		if it.Clocks[f] == "" {
			t.Errorf("item %q has no clock for %q", it.Name, f)
		}
	}
	if it.ServerSeq <= 0 {
		t.Errorf("item %q: ServerSeq = %d, want above 0", it.Name, it.ServerSeq)
	}
	if it.Checked && (it.CheckedBy == nil || it.CheckedAt == nil) {
		t.Errorf("item %q is checked without CheckedBy and CheckedAt", it.Name)
	}
}
