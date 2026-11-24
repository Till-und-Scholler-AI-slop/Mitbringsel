package list

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"tuolino/internal/group"
)

var errRepo = errors.New("repository failure")

// fakeRepo keeps lists in a map.
type fakeRepo struct {
	lists map[uuid.UUID]List
	// fail makes every method return errRepo.
	fail bool
	// failWrites makes only the methods that store something fail, so the
	// service gets past its own lookup first.
	failWrites bool
	// writes counts the calls that store something, successful or not.
	writes int
}

// write counts a storing call and reports whether it should fail.
func (r *fakeRepo) write() error {
	r.writes++
	if r.failWrites {
		return errRepo
	}
	return nil
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{lists: map[uuid.UUID]List{}}
}

func (r *fakeRepo) Create(_ context.Context, groupID uuid.UUID, name string, icon Icon) (List, error) {
	if r.fail {
		return List{}, errRepo
	}
	if err := r.write(); err != nil {
		return List{}, err
	}
	now := time.Now()
	l := List{ID: uuid.New(), GroupID: groupID, Name: name, Icon: icon, CreatedAt: now, UpdatedAt: now}
	r.lists[l.ID] = l
	return l, nil
}

func (r *fakeRepo) Get(_ context.Context, listID uuid.UUID) (List, error) {
	if r.fail {
		return List{}, errRepo
	}
	l, ok := r.lists[listID]
	if !ok {
		return List{}, ErrNotFound
	}
	return l, nil
}

func (r *fakeRepo) ListForGroup(_ context.Context, groupID uuid.UUID, includeArchived bool) ([]List, error) {
	if r.fail {
		return nil, errRepo
	}
	var out []List
	for _, l := range r.lists {
		if l.GroupID == groupID && (includeArchived || !l.Archived()) {
			out = append(out, l)
		}
	}
	return out, nil
}

func (r *fakeRepo) CountForGroup(_ context.Context, groupID uuid.UUID) (int, error) {
	if r.fail {
		return 0, errRepo
	}
	n := 0
	for _, l := range r.lists {
		if l.GroupID == groupID {
			n++
		}
	}
	return n, nil
}

func (r *fakeRepo) Update(_ context.Context, listID uuid.UUID, name string, icon Icon) (List, error) {
	l, err := r.Get(context.Background(), listID)
	if err != nil {
		return List{}, err
	}
	if err := r.write(); err != nil {
		return List{}, err
	}
	l.Name = name
	l.Icon = icon
	r.lists[listID] = l
	return l, nil
}

func (r *fakeRepo) SetArchived(_ context.Context, listID uuid.UUID, archived bool) (List, error) {
	l, err := r.Get(context.Background(), listID)
	if err != nil {
		return List{}, err
	}
	if err := r.write(); err != nil {
		return List{}, err
	}
	switch {
	case !archived:
		l.ArchivedAt = nil
	case l.ArchivedAt == nil:
		now := time.Now()
		l.ArchivedAt = &now
	}
	r.lists[listID] = l
	return l, nil
}

func (r *fakeRepo) Delete(_ context.Context, listID uuid.UUID) error {
	if _, err := r.Get(context.Background(), listID); err != nil {
		return err
	}
	if err := r.write(); err != nil {
		return err
	}
	delete(r.lists, listID)
	return nil
}

// listEvent is one call to the publisher.
type listEvent struct {
	kind  string // "changed" or "deleted"
	actor uuid.UUID
	list  List
}

// fakePublisher records what the service publishes.
type fakePublisher struct {
	events []listEvent
}

func (p *fakePublisher) ListChanged(_ context.Context, actor uuid.UUID, l List) {
	p.events = append(p.events, listEvent{"changed", actor, l})
}

func (p *fakePublisher) ListDeleted(_ context.Context, actor uuid.UUID, l List) {
	p.events = append(p.events, listEvent{"deleted", actor, l})
}

// fakeMembers maps group ID to user ID to role.
type fakeMembers map[uuid.UUID]map[uuid.UUID]group.Role

func (m fakeMembers) MemberRole(_ context.Context, groupID, userID uuid.UUID) (group.Role, error) {
	role, ok := m[groupID][userID]
	if !ok {
		return "", group.ErrNotFound
	}
	return role, nil
}

// fixture is one group with an owner, an admin and a member, plus a user
// outside the group.
type fixture struct {
	svc      *Service
	repo     *fakeRepo
	pub      *fakePublisher
	groupID  uuid.UUID
	owner    uuid.UUID
	admin    uuid.UUID
	member   uuid.UUID
	outsider uuid.UUID
}

func newFixture() fixture {
	f := fixture{
		repo:     newFakeRepo(),
		pub:      &fakePublisher{},
		groupID:  uuid.New(),
		owner:    uuid.New(),
		admin:    uuid.New(),
		member:   uuid.New(),
		outsider: uuid.New(),
	}
	members := fakeMembers{f.groupID: {
		f.owner:  group.RoleOwner,
		f.admin:  group.RoleAdmin,
		f.member: group.RoleMember,
	}}
	f.svc = NewService(f.repo, members, f.pub)
	return f
}

// newList stores a list with the default icon in the fixture's group.
func (f fixture) newList(t *testing.T, name string) List {
	t.Helper()
	l, err := f.repo.Create(context.Background(), f.groupID, name, DefaultIcon)
	if err != nil {
		t.Fatalf("create list: %v", err)
	}
	return l
}

func TestService_Create(t *testing.T) {
	ctx := context.Background()

	t.Run("every role may create, the name is trimmed", func(t *testing.T) {
		f := newFixture()
		for name, actor := range map[string]uuid.UUID{"owner": f.owner, "admin": f.admin, "member": f.member} {
			l, err := f.svc.Create(ctx, actor, f.groupID, "  Supermarkt  ", "")
			if err != nil {
				t.Fatalf("%s: Create() error = %v", name, err)
			}
			if l.Name != "Supermarkt" || l.GroupID != f.groupID {
				t.Errorf("%s: Create() = %+v, want trimmed name in the group", name, l)
			}
		}
	})

	t.Run("a group can have MaxListsPerGroup lists, archived ones included", func(t *testing.T) {
		f := newFixture()
		var first List
		for i := range MaxListsPerGroup - 1 {
			l := f.newList(t, fmt.Sprintf("Liste %d", i+1))
			if i == 0 {
				first = l
			}
		}
		if _, err := f.svc.Archive(ctx, f.member, first.ID); err != nil {
			t.Fatalf("Archive() error = %v", err)
		}
		if _, err := f.svc.Create(ctx, f.member, f.groupID, "Die letzte", ""); err != nil {
			t.Fatalf("Create() of the last list error = %v", err)
		}

		writes := f.repo.writes
		if _, err := f.svc.Create(ctx, f.member, f.groupID, "Eine zu viel", ""); !errors.Is(err, ErrTooManyLists) {
			t.Fatalf("Create() over the limit error = %v, want %v", err, ErrTooManyLists)
		}
		if f.repo.writes != writes {
			t.Error("Create() over the limit stored something")
		}

		// Deleting a list frees its place.
		if err := f.svc.Delete(ctx, f.admin, first.ID); err != nil {
			t.Fatalf("Delete() error = %v", err)
		}
		if _, err := f.svc.Create(ctx, f.member, f.groupID, "Wieder Platz", ""); err != nil {
			t.Errorf("Create() after Delete() error = %v", err)
		}
	})

	t.Run("outsider and unknown group are not found", func(t *testing.T) {
		f := newFixture()
		for name, tc := range map[string]struct{ actor, group uuid.UUID }{
			"outsider":      {f.outsider, f.groupID},
			"unknown group": {f.owner, uuid.New()},
		} {
			if _, err := f.svc.Create(ctx, tc.actor, tc.group, "Supermarkt", ""); !errors.Is(err, ErrNotFound) {
				t.Errorf("%s: error = %v, want %v", name, err, ErrNotFound)
			}
		}
		if len(f.repo.lists) != 0 {
			t.Errorf("stored %d lists, want none", len(f.repo.lists))
		}
	})

	t.Run("names", func(t *testing.T) {
		tests := []struct {
			name    string
			input   string
			wantErr error
		}{
			{"empty", "", ErrInvalidName},
			{"only spaces", "   ", ErrInvalidName},
			{"at the limit", strings.Repeat("ä", MaxNameLength), nil},
			{"over the limit", strings.Repeat("ä", MaxNameLength+1), ErrInvalidName},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				f := newFixture()
				_, err := f.svc.Create(ctx, f.member, f.groupID, tt.input, "")
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("error = %v, want %v", err, tt.wantErr)
				}
			})
		}
	})

	t.Run("icons", func(t *testing.T) {
		tests := []struct {
			name     string
			input    Icon
			wantIcon Icon
			wantErr  error
		}{
			{"none gets the default", "", DefaultIcon, nil},
			{"a known one is kept", IconBakery, IconBakery, nil},
			{"an unknown one is refused", "spaceship", "", ErrInvalidIcon},
			// The set is case-sensitive like the database CHECK.
			{"wrong case is refused", "Bakery", "", ErrInvalidIcon},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				f := newFixture()
				l, err := f.svc.Create(ctx, f.member, f.groupID, "Supermarkt", tt.input)
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("error = %v, want %v", err, tt.wantErr)
				}
				if l.Icon != tt.wantIcon {
					t.Errorf("icon = %q, want %q", l.Icon, tt.wantIcon)
				}
				if tt.wantErr != nil && len(f.repo.lists) != 0 {
					t.Errorf("stored %d lists, want none", len(f.repo.lists))
				}
			})
		}
	})

	t.Run("outsider learns nothing about the name and icon rules", func(t *testing.T) {
		f := newFixture()
		if _, err := f.svc.Create(ctx, f.outsider, f.groupID, "", ""); !errors.Is(err, ErrNotFound) {
			t.Errorf("error = %v, want %v, not %v", err, ErrNotFound, ErrInvalidName)
		}
		if _, err := f.svc.Create(ctx, f.outsider, f.groupID, "Supermarkt", "spaceship"); !errors.Is(err, ErrNotFound) {
			t.Errorf("error = %v, want %v, not %v", err, ErrNotFound, ErrInvalidIcon)
		}
	})

	t.Run("repository failure is passed on", func(t *testing.T) {
		f := newFixture()
		f.repo.fail = true
		if _, err := f.svc.Create(ctx, f.member, f.groupID, "Supermarkt", ""); !errors.Is(err, errRepo) {
			t.Errorf("error = %v, want %v", err, errRepo)
		}
	})
}

func TestService_ListForGroup(t *testing.T) {
	ctx := context.Background()
	f := newFixture()
	active := f.newList(t, "Supermarkt")
	archived := f.newList(t, "Baumarkt")
	if _, err := f.repo.SetArchived(ctx, archived.ID, true); err != nil {
		t.Fatal(err)
	}

	t.Run("active lists by default", func(t *testing.T) {
		lists, err := f.svc.ListForGroup(ctx, f.member, f.groupID, false)
		if err != nil {
			t.Fatalf("error = %v", err)
		}
		if len(lists) != 1 || lists[0].ID != active.ID {
			t.Errorf("lists = %+v, want only the active one", lists)
		}
	})

	t.Run("archived lists on request", func(t *testing.T) {
		lists, err := f.svc.ListForGroup(ctx, f.member, f.groupID, true)
		if err != nil {
			t.Fatalf("error = %v", err)
		}
		if len(lists) != 2 {
			t.Errorf("got %d lists, want 2", len(lists))
		}
	})

	t.Run("outsider is not found", func(t *testing.T) {
		if _, err := f.svc.ListForGroup(ctx, f.outsider, f.groupID, true); !errors.Is(err, ErrNotFound) {
			t.Errorf("error = %v, want %v", err, ErrNotFound)
		}
	})
}

func TestService_Get(t *testing.T) {
	ctx := context.Background()
	f := newFixture()
	l := f.newList(t, "Supermarkt")

	got, err := f.svc.Get(ctx, f.member, l.ID)
	if err != nil || got.ID != l.ID {
		t.Errorf("Get() by member = %+v, %v, want the list", got, err)
	}
	if _, err := f.svc.Get(ctx, f.outsider, l.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get() by outsider error = %v, want %v", err, ErrNotFound)
	}
	if _, err := f.svc.Get(ctx, f.member, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get() of unknown list error = %v, want %v", err, ErrNotFound)
	}
}

func TestService_Update(t *testing.T) {
	ctx := context.Background()

	t.Run("every role may rename", func(t *testing.T) {
		f := newFixture()
		l := f.newList(t, "Old")
		for name, actor := range map[string]uuid.UUID{"owner": f.owner, "admin": f.admin, "member": f.member} {
			got, err := f.svc.Update(ctx, actor, l.ID, " New ", "")
			if err != nil || got.Name != "New" {
				t.Errorf("%s: Update() = %+v, %v, want name New", name, got, err)
			}
		}
	})

	t.Run("outsider is not found and nothing changes", func(t *testing.T) {
		f := newFixture()
		l := f.newList(t, "Old")
		if _, err := f.svc.Update(ctx, f.outsider, l.ID, "New", ""); !errors.Is(err, ErrNotFound) {
			t.Errorf("error = %v, want %v", err, ErrNotFound)
		}
		if f.repo.lists[l.ID].Name != "Old" {
			t.Errorf("name = %q, want Old", f.repo.lists[l.ID].Name)
		}
	})

	t.Run("invalid name", func(t *testing.T) {
		f := newFixture()
		l := f.newList(t, "Old")
		if _, err := f.svc.Update(ctx, f.member, l.ID, " ", ""); !errors.Is(err, ErrInvalidName) {
			t.Errorf("error = %v, want %v", err, ErrInvalidName)
		}
	})

	t.Run("a new icon is stored, the name may stay", func(t *testing.T) {
		f := newFixture()
		l := f.newList(t, "Supermarkt")
		got, err := f.svc.Update(ctx, f.member, l.ID, "Supermarkt", IconSupermarket)
		if err != nil || got.Icon != IconSupermarket || got.Name != "Supermarkt" {
			t.Errorf("Update() = %+v, %v, want icon %q and the old name", got, err, IconSupermarket)
		}
	})

	t.Run("no icon keeps the current one", func(t *testing.T) {
		f := newFixture()
		l := f.newList(t, "Old")
		if _, err := f.svc.Update(ctx, f.member, l.ID, "Old", IconBakery); err != nil {
			t.Fatal(err)
		}
		got, err := f.svc.Update(ctx, f.member, l.ID, "New", "")
		if err != nil || got.Icon != IconBakery || got.Name != "New" {
			t.Errorf("Update() = %+v, %v, want name New and icon %q", got, err, IconBakery)
		}
	})

	t.Run("invalid icon changes nothing", func(t *testing.T) {
		f := newFixture()
		l := f.newList(t, "Old")
		if _, err := f.svc.Update(ctx, f.member, l.ID, "New", "spaceship"); !errors.Is(err, ErrInvalidIcon) {
			t.Errorf("error = %v, want %v", err, ErrInvalidIcon)
		}
		if got := f.repo.lists[l.ID]; got.Name != "Old" || got.Icon != DefaultIcon {
			t.Errorf("stored %+v, want it unchanged", got)
		}
	})
}

func TestService_Archive(t *testing.T) {
	ctx := context.Background()
	f := newFixture()
	l := f.newList(t, "Supermarkt")

	archived, err := f.svc.Archive(ctx, f.member, l.ID)
	if err != nil || !archived.Archived() {
		t.Fatalf("Archive() = %+v, %v, want an archived list", archived, err)
	}
	restored, err := f.svc.Unarchive(ctx, f.member, l.ID)
	if err != nil || restored.Archived() {
		t.Fatalf("Unarchive() = %+v, %v, want an active list", restored, err)
	}

	if _, err := f.svc.Archive(ctx, f.outsider, l.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("Archive() by outsider error = %v, want %v", err, ErrNotFound)
	}
	if _, err := f.svc.Unarchive(ctx, f.outsider, l.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("Unarchive() by outsider error = %v, want %v", err, ErrNotFound)
	}
}

func TestService_Delete(t *testing.T) {
	ctx := context.Background()
	f := newFixture()

	tests := []struct {
		name    string
		actor   uuid.UUID
		wantErr error
	}{
		{"owner", f.owner, nil},
		{"admin", f.admin, nil},
		{"member", f.member, ErrForbidden},
		{"outsider", f.outsider, ErrNotFound},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := f.newList(t, "Supermarkt")
			err := f.svc.Delete(ctx, tt.actor, l.ID)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want %v", err, tt.wantErr)
			}
			_, stored := f.repo.lists[l.ID]
			if wantStored := tt.wantErr != nil; stored != wantStored {
				t.Errorf("list stored = %v, want %v", stored, wantStored)
			}
		})
	}

	t.Run("unknown list is not found", func(t *testing.T) {
		if err := f.svc.Delete(ctx, f.owner, uuid.New()); !errors.Is(err, ErrNotFound) {
			t.Errorf("error = %v, want %v", err, ErrNotFound)
		}
	})
}

func TestService_repositoryFailure(t *testing.T) {
	ctx := context.Background()
	f := newFixture()
	l := f.newList(t, "Supermarkt")
	f.repo.fail = true

	if _, err := f.svc.Get(ctx, f.member, l.ID); !errors.Is(err, errRepo) {
		t.Errorf("Get() error = %v, want %v", err, errRepo)
	}
	if _, err := f.svc.ListForGroup(ctx, f.member, f.groupID, false); !errors.Is(err, errRepo) {
		t.Errorf("ListForGroup() error = %v, want %v", err, errRepo)
	}
	if _, err := f.svc.Create(ctx, f.member, f.groupID, "Drogerie", ""); !errors.Is(err, errRepo) {
		t.Errorf("Create() error = %v, want %v", err, errRepo)
	}
}

func TestService_publishes(t *testing.T) {
	ctx := context.Background()

	tests := []struct {
		name string
		// setup stores the list the action works on.
		setup func(t *testing.T, f fixture) List
		act   func(f fixture, l List) error
		// wantKind is "changed", "deleted" or "" for no event. An event
		// always carries the acting user and the list.
		wantKind string
		// wantWrite says whether the repository stored anything.
		wantWrite bool
		wantErr   error
		// check looks at the published list besides its ID.
		check func(t *testing.T, got List)
	}{
		{
			name: "create",
			act: func(f fixture, _ List) error {
				_, err := f.svc.Create(ctx, f.member, f.groupID, "Supermarkt", "")
				return err
			},
			wantKind:  "changed",
			wantWrite: true,
			check: func(t *testing.T, got List) {
				if got.Name != "Supermarkt" {
					t.Errorf("published name = %q, want Supermarkt", got.Name)
				}
			},
		},
		{
			name:      "rename",
			setup:     func(t *testing.T, f fixture) List { return f.newList(t, "Old") },
			act:       func(f fixture, l List) error { _, err := f.svc.Update(ctx, f.member, l.ID, " New ", ""); return err },
			wantKind:  "changed",
			wantWrite: true,
			check: func(t *testing.T, got List) {
				if got.Name != "New" {
					t.Errorf("published name = %q, want the stored name New", got.Name)
				}
			},
		},
		{
			name:  "change only the icon",
			setup: func(t *testing.T, f fixture) List { return f.newList(t, "Supermarkt") },
			act: func(f fixture, l List) error {
				_, err := f.svc.Update(ctx, f.member, l.ID, "Supermarkt", IconMarket)
				return err
			},
			wantKind:  "changed",
			wantWrite: true,
			check: func(t *testing.T, got List) {
				if got.Icon != IconMarket {
					t.Errorf("published icon = %q, want %q", got.Icon, IconMarket)
				}
			},
		},
		{
			name:      "archive",
			setup:     func(t *testing.T, f fixture) List { return f.newList(t, "Supermarkt") },
			act:       func(f fixture, l List) error { _, err := f.svc.Archive(ctx, f.member, l.ID); return err },
			wantKind:  "changed",
			wantWrite: true,
			check: func(t *testing.T, got List) {
				if !got.Archived() {
					t.Error("published list is not archived")
				}
			},
		},
		{
			name: "unarchive",
			setup: func(t *testing.T, f fixture) List {
				l := f.newList(t, "Supermarkt")
				l, err := f.repo.SetArchived(ctx, l.ID, true)
				if err != nil {
					t.Fatal(err)
				}
				return l
			},
			act:       func(f fixture, l List) error { _, err := f.svc.Unarchive(ctx, f.member, l.ID); return err },
			wantKind:  "changed",
			wantWrite: true,
			check: func(t *testing.T, got List) {
				if got.Archived() {
					t.Error("published list is still archived")
				}
			},
		},
		{
			name:      "delete by the owner",
			setup:     func(t *testing.T, f fixture) List { return f.newList(t, "Supermarkt") },
			act:       func(f fixture, l List) error { return f.svc.Delete(ctx, f.owner, l.ID) },
			wantKind:  "deleted",
			wantWrite: true,
			check: func(t *testing.T, got List) {
				if got.GroupID == uuid.Nil || got.Name != "Supermarkt" {
					t.Errorf("published %+v, want the list as it was, with its group", got)
				}
			},
		},
		{
			name:    "create with an invalid name",
			act:     func(f fixture, _ List) error { _, err := f.svc.Create(ctx, f.member, f.groupID, " ", ""); return err },
			wantErr: ErrInvalidName,
		},
		{
			name: "create by an outsider",
			act: func(f fixture, _ List) error {
				_, err := f.svc.Create(ctx, f.outsider, f.groupID, "Supermarkt", "")
				return err
			},
			wantErr: ErrNotFound,
		},
		{
			name:    "rename with an invalid name",
			setup:   func(t *testing.T, f fixture) List { return f.newList(t, "Old") },
			act:     func(f fixture, l List) error { _, err := f.svc.Update(ctx, f.member, l.ID, "", ""); return err },
			wantErr: ErrInvalidName,
		},
		{
			name:    "rename by an outsider",
			setup:   func(t *testing.T, f fixture) List { return f.newList(t, "Old") },
			act:     func(f fixture, l List) error { _, err := f.svc.Update(ctx, f.outsider, l.ID, "New", ""); return err },
			wantErr: ErrNotFound,
		},
		{
			name:  "rename to the same name",
			setup: func(t *testing.T, f fixture) List { return f.newList(t, "Supermarkt") },
			act: func(f fixture, l List) error {
				_, err := f.svc.Update(ctx, f.member, l.ID, " Supermarkt ", "")
				return err
			},
		},
		{
			name:  "update to the same name and icon",
			setup: func(t *testing.T, f fixture) List { return f.newList(t, "Supermarkt") },
			act: func(f fixture, l List) error {
				_, err := f.svc.Update(ctx, f.member, l.ID, "Supermarkt", DefaultIcon)
				return err
			},
		},
		{
			name:  "update with an invalid icon",
			setup: func(t *testing.T, f fixture) List { return f.newList(t, "Supermarkt") },
			act: func(f fixture, l List) error {
				_, err := f.svc.Update(ctx, f.member, l.ID, "Supermarkt", "x")
				return err
			},
			wantErr: ErrInvalidIcon,
		},
		{
			name: "archive an archived list",
			setup: func(t *testing.T, f fixture) List {
				l := f.newList(t, "Supermarkt")
				l, err := f.repo.SetArchived(ctx, l.ID, true)
				if err != nil {
					t.Fatal(err)
				}
				return l
			},
			act: func(f fixture, l List) error { _, err := f.svc.Archive(ctx, f.member, l.ID); return err },
		},
		{
			name:  "unarchive an active list",
			setup: func(t *testing.T, f fixture) List { return f.newList(t, "Supermarkt") },
			act:   func(f fixture, l List) error { _, err := f.svc.Unarchive(ctx, f.member, l.ID); return err },
		},
		{
			name:    "archive by an outsider",
			setup:   func(t *testing.T, f fixture) List { return f.newList(t, "Supermarkt") },
			act:     func(f fixture, l List) error { _, err := f.svc.Archive(ctx, f.outsider, l.ID); return err },
			wantErr: ErrNotFound,
		},
		{
			name:    "delete by a member",
			setup:   func(t *testing.T, f fixture) List { return f.newList(t, "Supermarkt") },
			act:     func(f fixture, l List) error { return f.svc.Delete(ctx, f.member, l.ID) },
			wantErr: ErrForbidden,
		},
		{
			name:    "delete by an outsider",
			setup:   func(t *testing.T, f fixture) List { return f.newList(t, "Supermarkt") },
			act:     func(f fixture, l List) error { return f.svc.Delete(ctx, f.outsider, l.ID) },
			wantErr: ErrNotFound,
		},
		{
			name:  "create fails in the repository",
			setup: func(t *testing.T, f fixture) List { f.repo.failWrites = true; return List{} },
			act: func(f fixture, _ List) error {
				_, err := f.svc.Create(ctx, f.member, f.groupID, "Supermarkt", "")
				return err
			},
			wantWrite: true,
			wantErr:   errRepo,
		},
		{
			name: "rename fails in the repository",
			setup: func(t *testing.T, f fixture) List {
				l := f.newList(t, "Old")
				f.repo.failWrites = true
				return l
			},
			act:       func(f fixture, l List) error { _, err := f.svc.Update(ctx, f.member, l.ID, "New", ""); return err },
			wantWrite: true,
			wantErr:   errRepo,
		},
		{
			name: "delete fails in the repository",
			setup: func(t *testing.T, f fixture) List {
				l := f.newList(t, "Supermarkt")
				f.repo.failWrites = true
				return l
			},
			act:       func(f fixture, l List) error { return f.svc.Delete(ctx, f.owner, l.ID) },
			wantWrite: true,
			wantErr:   errRepo,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newFixture()
			var l List
			if tt.setup != nil {
				l = tt.setup(t, f)
			}
			// The setup's own writes do not count.
			f.repo.writes = 0

			err := tt.act(f, l)

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("error = %v, want %v", err, tt.wantErr)
			}
			if wrote := f.repo.writes > 0; wrote != tt.wantWrite {
				t.Errorf("repository writes = %d, want written = %v", f.repo.writes, tt.wantWrite)
			}
			if tt.wantKind == "" {
				if len(f.pub.events) != 0 {
					t.Errorf("published %+v, want nothing", f.pub.events)
				}
				return
			}
			if len(f.pub.events) != 1 {
				t.Fatalf("published %d events, want 1: %+v", len(f.pub.events), f.pub.events)
			}
			ev := f.pub.events[0]
			if ev.kind != tt.wantKind || ev.list.GroupID != f.groupID {
				t.Errorf("published %+v, want %q in the group", ev, tt.wantKind)
			}
			if tt.wantKind == "changed" && ev.list != f.repo.lists[ev.list.ID] {
				t.Errorf("published %+v, want the stored list %+v", ev.list, f.repo.lists[ev.list.ID])
			}
			if l.ID != uuid.Nil && ev.list.ID != l.ID {
				t.Errorf("published list %v, want %v", ev.list.ID, l.ID)
			}
			if tt.check != nil {
				tt.check(t, ev.list)
			}
		})
	}
}

func TestNewService_nilPublisher(t *testing.T) {
	f := newFixture()
	svc := NewService(f.repo, fakeMembers{f.groupID: {f.owner: group.RoleOwner}}, nil)
	ctx := context.Background()

	l, err := svc.Create(ctx, f.owner, f.groupID, "Supermarkt", "")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := svc.Update(ctx, f.owner, l.ID, "Baumarkt", ""); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if _, err := svc.Archive(ctx, f.owner, l.ID); err != nil {
		t.Fatalf("Archive() error = %v", err)
	}
	if err := svc.Delete(ctx, f.owner, l.ID); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
}
