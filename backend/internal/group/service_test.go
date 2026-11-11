package group

import (
	"context"
	"errors"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

var errRepo = errors.New("repository failure")

// fakeRepo keeps groups and roles in maps. InTx copies the state and puts
// it back if fn fails, like a rolled-back transaction would.
type fakeRepo struct {
	groups map[uuid.UUID]Group
	// roles maps group ID to user ID to role.
	roles map[uuid.UUID]map[uuid.UUID]Role
	// failAddMember makes AddMember fail, to test the rollback in Create.
	failAddMember bool
	// locked records which groups were locked, in order.
	locked []uuid.UUID
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{groups: map[uuid.UUID]Group{}, roles: map[uuid.UUID]map[uuid.UUID]Role{}}
}

func (r *fakeRepo) InTx(_ context.Context, fn func(tx Repository) error) error {
	groups := maps.Clone(r.groups)
	roles := make(map[uuid.UUID]map[uuid.UUID]Role, len(r.roles))
	for id, m := range r.roles {
		roles[id] = maps.Clone(m)
	}
	if err := fn(r); err != nil {
		r.groups, r.roles = groups, roles
		return err
	}
	return nil
}

func (r *fakeRepo) Lock(_ context.Context, groupID uuid.UUID) error {
	if _, ok := r.groups[groupID]; !ok {
		return ErrNotFound
	}
	r.locked = append(r.locked, groupID)
	return nil
}

func (r *fakeRepo) Create(_ context.Context, name string, _ uuid.UUID) (Group, error) {
	now := time.Now()
	g := Group{ID: uuid.New(), Name: name, CreatedAt: now, UpdatedAt: now}
	r.groups[g.ID] = g
	r.roles[g.ID] = map[uuid.UUID]Role{}
	return g, nil
}

func (r *fakeRepo) Get(_ context.Context, groupID uuid.UUID) (Group, error) {
	g, ok := r.groups[groupID]
	if !ok {
		return Group{}, ErrNotFound
	}
	return g, nil
}

func (r *fakeRepo) Rename(_ context.Context, groupID uuid.UUID, name string) (Group, error) {
	g, ok := r.groups[groupID]
	if !ok {
		return Group{}, ErrNotFound
	}
	g.Name = name
	r.groups[groupID] = g
	return g, nil
}

func (r *fakeRepo) Delete(_ context.Context, groupID uuid.UUID) error {
	if _, ok := r.groups[groupID]; !ok {
		return ErrNotFound
	}
	delete(r.groups, groupID)
	delete(r.roles, groupID)
	return nil
}

func (r *fakeRepo) ListForUser(_ context.Context, userID uuid.UUID) ([]Membership, error) {
	var out []Membership
	for id, roles := range r.roles {
		if role, ok := roles[userID]; ok {
			out = append(out, Membership{Group: r.groups[id], Role: role})
		}
	}
	return out, nil
}

func (r *fakeRepo) Members(_ context.Context, groupIDs []uuid.UUID) (map[uuid.UUID][]Member, error) {
	out := map[uuid.UUID][]Member{}
	for _, id := range groupIDs {
		for userID, role := range r.roles[id] {
			out[id] = append(out[id], Member{UserID: userID, Role: role})
		}
	}
	return out, nil
}

func (r *fakeRepo) MemberRole(_ context.Context, groupID, userID uuid.UUID) (Role, error) {
	role, ok := r.roles[groupID][userID]
	if !ok {
		return "", ErrNotFound
	}
	return role, nil
}

func (r *fakeRepo) AddMember(_ context.Context, groupID, userID uuid.UUID, role Role) error {
	if r.failAddMember {
		return errRepo
	}
	r.roles[groupID][userID] = role
	return nil
}

func (r *fakeRepo) RemoveMember(_ context.Context, groupID, userID uuid.UUID) error {
	if _, ok := r.roles[groupID][userID]; !ok {
		return ErrNotFound
	}
	delete(r.roles[groupID], userID)
	return nil
}

func (r *fakeRepo) SetRole(_ context.Context, groupID, userID uuid.UUID, role Role) error {
	if _, ok := r.roles[groupID][userID]; !ok {
		return ErrNotFound
	}
	r.roles[groupID][userID] = role
	return nil
}

// fixture is one group with an owner, an admin and a member, plus an
// outsider who is in no group at all.
type fixture struct {
	repo                           *fakeRepo
	svc                            *Service
	group                          uuid.UUID
	owner, admin, member, outsider uuid.UUID
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	f := fixture{
		repo:     newFakeRepo(),
		owner:    uuid.New(),
		admin:    uuid.New(),
		member:   uuid.New(),
		outsider: uuid.New(),
	}
	f.svc = NewService(f.repo)
	d, err := f.svc.Create(context.Background(), f.owner, "WG Kaiserstraße")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	f.group = d.ID
	f.repo.roles[f.group][f.admin] = RoleAdmin
	f.repo.roles[f.group][f.member] = RoleMember
	return f
}

// who picks one user of the fixture, so table tests can name actors and
// targets before the fixture exists.
type who func(f fixture) uuid.UUID

func owner(f fixture) uuid.UUID    { return f.owner }
func admin(f fixture) uuid.UUID    { return f.admin }
func member(f fixture) uuid.UUID   { return f.member }
func outsider(f fixture) uuid.UUID { return f.outsider }

func TestService_Create(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		wantName string
		wantErr  error
	}{
		{name: "plain name", input: "WG Kaiserstraße", wantName: "WG Kaiserstraße"},
		{name: "surrounding whitespace is trimmed", input: "  Zuhause \n", wantName: "Zuhause"},
		// 30 characters but 60 bytes: the limit counts characters.
		{name: "longest name", input: strings.Repeat("ß", MaxNameLength), wantName: strings.Repeat("ß", MaxNameLength)},
		{name: "empty name", input: "", wantErr: ErrInvalidName},
		{name: "only whitespace", input: "   ", wantErr: ErrInvalidName},
		{name: "too long", input: strings.Repeat("a", MaxNameLength+1), wantErr: ErrInvalidName},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := newFakeRepo()
			actor := uuid.New()

			got, err := NewService(repo).Create(context.Background(), actor, tt.input)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("Create() error = %v, want %v", err, tt.wantErr)
				}
				if len(repo.groups) != 0 {
					t.Errorf("invalid name stored a group")
				}
				return
			}
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}
			if got.Name != tt.wantName {
				t.Errorf("Name = %q, want %q", got.Name, tt.wantName)
			}
			if got.Role != RoleOwner {
				t.Errorf("Role = %q, want %q", got.Role, RoleOwner)
			}
			if len(got.Members) != 1 || got.Members[0].UserID != actor || got.Members[0].Role != RoleOwner {
				t.Errorf("Members = %+v, want only the creator as owner", got.Members)
			}
		})
	}
}

func TestService_CreateStoresNothingWithoutOwner(t *testing.T) {
	repo := newFakeRepo()
	repo.failAddMember = true

	_, err := NewService(repo).Create(context.Background(), uuid.New(), "WG")

	if !errors.Is(err, errRepo) {
		t.Fatalf("Create() error = %v, want %v", err, errRepo)
	}
	if len(repo.groups) != 0 {
		t.Error("group without owner was stored")
	}
}

func TestService_List(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	other, err := f.svc.Create(ctx, f.member, "Zuhause")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	got, err := f.svc.List(ctx, f.member)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	roles := map[uuid.UUID]Role{}
	for _, d := range got {
		roles[d.ID] = d.Role
		if len(d.Members) == 0 {
			t.Errorf("group %q has no members", d.Name)
		}
	}
	want := map[uuid.UUID]Role{f.group: RoleMember, other.ID: RoleOwner}
	if !maps.Equal(roles, want) {
		t.Errorf("List() roles = %v, want %v", roles, want)
	}

	none, err := f.svc.List(ctx, f.outsider)
	if err != nil || none == nil || len(none) != 0 {
		t.Errorf("List() for outsider = %v, %v; want an empty, non-nil slice", none, err)
	}
}

func TestService_GroupIDs(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	other, err := f.svc.Create(ctx, f.member, "Zuhause")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	got, err := f.svc.GroupIDs(ctx, f.member)
	if err != nil {
		t.Fatalf("GroupIDs() error = %v", err)
	}
	// The repository does not promise an order.
	if len(got) != 2 || !slices.Contains(got, f.group) || !slices.Contains(got, other.ID) {
		t.Errorf("GroupIDs() = %v, want %v and %v", got, f.group, other.ID)
	}

	none, err := f.svc.GroupIDs(ctx, f.outsider)
	if err != nil || none == nil || len(none) != 0 {
		t.Errorf("GroupIDs() for outsider = %v, %v; want an empty, non-nil slice", none, err)
	}
}

func TestService_Get(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	got, err := f.svc.Get(ctx, f.member, f.group)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if got.Role != RoleMember || len(got.Members) != 3 {
		t.Errorf("Get() = %+v, want role member and 3 members", got)
	}

	// An outsider and an unknown ID get the same answer.
	if _, err := f.svc.Get(ctx, f.outsider, f.group); !errors.Is(err, ErrNotFound) {
		t.Errorf("outsider: Get() error = %v, want %v", err, ErrNotFound)
	}
	if _, err := f.svc.Get(ctx, f.owner, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown group: Get() error = %v, want %v", err, ErrNotFound)
	}
}

func TestService_RenameAndDelete(t *testing.T) {
	tests := []struct {
		name          string
		actor         who
		wantRenameErr error
		wantDeleteErr error
	}{
		{name: "owner", actor: owner},
		{name: "admin", actor: admin, wantDeleteErr: ErrForbidden},
		{name: "member", actor: member, wantRenameErr: ErrForbidden, wantDeleteErr: ErrForbidden},
		{name: "outsider", actor: outsider, wantRenameErr: ErrNotFound, wantDeleteErr: ErrNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name+" renames", func(t *testing.T) {
			f := newFixture(t)

			got, err := f.svc.Rename(context.Background(), tt.actor(f), f.group, " WG Kaiserstr. 5 ")

			if !errors.Is(err, tt.wantRenameErr) {
				t.Fatalf("Rename() error = %v, want %v", err, tt.wantRenameErr)
			}
			if tt.wantRenameErr == nil && got.Name != "WG Kaiserstr. 5" {
				t.Errorf("Name = %q, want trimmed new name", got.Name)
			}
		})
		t.Run(tt.name+" deletes", func(t *testing.T) {
			f := newFixture(t)

			err := f.svc.Delete(context.Background(), tt.actor(f), f.group)

			if !errors.Is(err, tt.wantDeleteErr) {
				t.Fatalf("Delete() error = %v, want %v", err, tt.wantDeleteErr)
			}
			_, stillThere := f.repo.groups[f.group]
			if stillThere != (tt.wantDeleteErr != nil) {
				t.Errorf("group still stored = %v", stillThere)
			}
		})
	}

	t.Run("invalid name", func(t *testing.T) {
		f := newFixture(t)
		if _, err := f.svc.Rename(context.Background(), f.owner, f.group, " "); !errors.Is(err, ErrInvalidName) {
			t.Errorf("Rename() error = %v, want %v", err, ErrInvalidName)
		}
	})
}

func TestService_RemoveMember(t *testing.T) {
	tests := []struct {
		name    string
		actor   who
		target  who
		wantErr error
	}{
		{name: "member leaves", actor: member, target: member},
		{name: "admin leaves", actor: admin, target: admin},
		{name: "owner cannot leave", actor: owner, target: owner, wantErr: ErrOwnerImmutable},
		{name: "owner removes a member", actor: owner, target: member},
		{name: "owner removes an admin", actor: owner, target: admin},
		{name: "admin removes a member", actor: admin, target: member},
		{name: "admin cannot remove the owner", actor: admin, target: owner, wantErr: ErrForbidden},
		{name: "member cannot remove an admin", actor: member, target: admin, wantErr: ErrForbidden},
		{name: "member cannot remove the owner", actor: member, target: owner, wantErr: ErrForbidden},
		{name: "target is not a member", actor: owner, target: outsider, wantErr: ErrNotFound},
		{name: "outsider", actor: outsider, target: member, wantErr: ErrNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newFixture(t)
			target := tt.target(f)

			err := f.svc.RemoveMember(context.Background(), tt.actor(f), f.group, target)

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("RemoveMember() error = %v, want %v", err, tt.wantErr)
			}
			_, stillMember := f.repo.roles[f.group][target]
			if tt.wantErr == nil && stillMember {
				t.Error("target is still a member")
			}
			if tt.wantErr != nil && target != f.outsider && !stillMember {
				t.Error("target was removed despite the error")
			}
			if len(f.repo.locked) != 1 || f.repo.locked[0] != f.group {
				t.Errorf("locked = %v, want the group once", f.repo.locked)
			}
		})
	}

	t.Run("unknown group", func(t *testing.T) {
		f := newFixture(t)
		if err := f.svc.RemoveMember(context.Background(), f.owner, uuid.New(), f.member); !errors.Is(err, ErrNotFound) {
			t.Errorf("RemoveMember() error = %v, want %v", err, ErrNotFound)
		}
	})
}

func TestService_SetRole(t *testing.T) {
	tests := []struct {
		name     string
		actor    who
		target   who
		role     Role
		wantErr  error
		wantRole Role
	}{
		{name: "owner makes a member admin", actor: owner, target: member, role: RoleAdmin, wantRole: RoleAdmin},
		{name: "owner makes an admin member", actor: owner, target: admin, role: RoleMember, wantRole: RoleMember},
		{name: "same role changes nothing", actor: owner, target: admin, role: RoleAdmin, wantRole: RoleAdmin},
		{name: "admin cannot hand out admin", actor: admin, target: member, role: RoleAdmin, wantErr: ErrForbidden, wantRole: RoleMember},
		{name: "member cannot promote themselves", actor: member, target: member, role: RoleAdmin, wantErr: ErrForbidden, wantRole: RoleMember},
		{name: "owner cannot step down", actor: owner, target: owner, role: RoleMember, wantErr: ErrOwnerImmutable, wantRole: RoleOwner},
		{name: "nobody becomes owner", actor: owner, target: member, role: RoleOwner, wantErr: ErrInvalidRole, wantRole: RoleMember},
		{name: "unknown role", actor: owner, target: member, role: Role("superuser"), wantErr: ErrInvalidRole, wantRole: RoleMember},
		{name: "target is not a member", actor: owner, target: outsider, role: RoleAdmin, wantErr: ErrNotFound},
		{name: "outsider", actor: outsider, target: member, role: RoleAdmin, wantErr: ErrNotFound, wantRole: RoleMember},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newFixture(t)
			target := tt.target(f)

			err := f.svc.SetRole(context.Background(), tt.actor(f), f.group, target, tt.role)

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("SetRole() error = %v, want %v", err, tt.wantErr)
			}
			if got := f.repo.roles[f.group][target]; got != tt.wantRole {
				t.Errorf("role = %q, want %q", got, tt.wantRole)
			}
		})
	}
}
