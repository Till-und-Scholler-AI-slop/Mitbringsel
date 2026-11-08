package list

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"mitbringsel/internal/group"
)

var errRepo = errors.New("repository failure")

// fakeRepo keeps lists in a map.
type fakeRepo struct {
	lists map[uuid.UUID]List
	// fail makes every method return errRepo.
	fail bool
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{lists: map[uuid.UUID]List{}}
}

func (r *fakeRepo) Create(_ context.Context, groupID uuid.UUID, name string) (List, error) {
	if r.fail {
		return List{}, errRepo
	}
	now := time.Now()
	l := List{ID: uuid.New(), GroupID: groupID, Name: name, CreatedAt: now, UpdatedAt: now}
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

func (r *fakeRepo) Rename(_ context.Context, listID uuid.UUID, name string) (List, error) {
	l, err := r.Get(context.Background(), listID)
	if err != nil {
		return List{}, err
	}
	l.Name = name
	r.lists[listID] = l
	return l, nil
}

func (r *fakeRepo) SetArchived(_ context.Context, listID uuid.UUID, archived bool) (List, error) {
	l, err := r.Get(context.Background(), listID)
	if err != nil {
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
	delete(r.lists, listID)
	return nil
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
	groupID  uuid.UUID
	owner    uuid.UUID
	admin    uuid.UUID
	member   uuid.UUID
	outsider uuid.UUID
}

func newFixture() fixture {
	f := fixture{
		repo:     newFakeRepo(),
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
	f.svc = NewService(f.repo, members)
	return f
}

// newList stores a list in the fixture's group.
func (f fixture) newList(t *testing.T, name string) List {
	t.Helper()
	l, err := f.repo.Create(context.Background(), f.groupID, name)
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
			l, err := f.svc.Create(ctx, actor, f.groupID, "  Supermarkt  ")
			if err != nil {
				t.Fatalf("%s: Create() error = %v", name, err)
			}
			if l.Name != "Supermarkt" || l.GroupID != f.groupID {
				t.Errorf("%s: Create() = %+v, want trimmed name in the group", name, l)
			}
		}
	})

	t.Run("outsider and unknown group are not found", func(t *testing.T) {
		f := newFixture()
		for name, tc := range map[string]struct{ actor, group uuid.UUID }{
			"outsider":      {f.outsider, f.groupID},
			"unknown group": {f.owner, uuid.New()},
		} {
			if _, err := f.svc.Create(ctx, tc.actor, tc.group, "Supermarkt"); !errors.Is(err, ErrNotFound) {
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
				_, err := f.svc.Create(ctx, f.member, f.groupID, tt.input)
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("error = %v, want %v", err, tt.wantErr)
				}
			})
		}
	})

	t.Run("outsider learns nothing about the name rules", func(t *testing.T) {
		f := newFixture()
		if _, err := f.svc.Create(ctx, f.outsider, f.groupID, ""); !errors.Is(err, ErrNotFound) {
			t.Errorf("error = %v, want %v, not %v", err, ErrNotFound, ErrInvalidName)
		}
	})

	t.Run("repository failure is passed on", func(t *testing.T) {
		f := newFixture()
		f.repo.fail = true
		if _, err := f.svc.Create(ctx, f.member, f.groupID, "Supermarkt"); !errors.Is(err, errRepo) {
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

func TestService_Rename(t *testing.T) {
	ctx := context.Background()

	t.Run("every role may rename", func(t *testing.T) {
		f := newFixture()
		l := f.newList(t, "Old")
		for name, actor := range map[string]uuid.UUID{"owner": f.owner, "admin": f.admin, "member": f.member} {
			got, err := f.svc.Rename(ctx, actor, l.ID, " New ")
			if err != nil || got.Name != "New" {
				t.Errorf("%s: Rename() = %+v, %v, want name New", name, got, err)
			}
		}
	})

	t.Run("outsider is not found and nothing changes", func(t *testing.T) {
		f := newFixture()
		l := f.newList(t, "Old")
		if _, err := f.svc.Rename(ctx, f.outsider, l.ID, "New"); !errors.Is(err, ErrNotFound) {
			t.Errorf("error = %v, want %v", err, ErrNotFound)
		}
		if f.repo.lists[l.ID].Name != "Old" {
			t.Errorf("name = %q, want Old", f.repo.lists[l.ID].Name)
		}
	})

	t.Run("invalid name", func(t *testing.T) {
		f := newFixture()
		l := f.newList(t, "Old")
		if _, err := f.svc.Rename(ctx, f.member, l.ID, " "); !errors.Is(err, ErrInvalidName) {
			t.Errorf("error = %v, want %v", err, ErrInvalidName)
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
}
