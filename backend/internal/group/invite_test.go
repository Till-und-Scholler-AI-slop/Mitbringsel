package group

import (
	"bytes"
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

var inviteNow = time.Date(2026, time.November, 3, 12, 0, 0, 0, time.UTC)

// fakeInviteRepo keeps roles and invites in memory.
type fakeInviteRepo struct {
	// roles maps group ID to user ID to role.
	roles   map[uuid.UUID]map[uuid.UUID]Role
	groups  map[uuid.UUID]Group
	invites []fakeInvite
}

type fakeInvite struct {
	Invite
	hash    []byte
	revoked bool
}

func (r *fakeInviteRepo) MemberRole(_ context.Context, groupID, userID uuid.UUID) (Role, error) {
	role, ok := r.roles[groupID][userID]
	if !ok {
		return "", ErrNotFound
	}
	return role, nil
}

func (r *fakeInviteRepo) active(groupID uuid.UUID, now time.Time) []Invite {
	var out []Invite
	for _, i := range r.invites {
		if i.GroupID == groupID && !i.revoked && i.ExpiresAt.After(now) {
			out = append(out, i.Invite)
		}
	}
	return out
}

func (r *fakeInviteRepo) CreateInvite(_ context.Context, groupID, _ uuid.UUID, tokenHash []byte, expiresAt time.Time) (Invite, error) {
	i := Invite{ID: uuid.New(), GroupID: groupID, CreatedAt: inviteNow, ExpiresAt: expiresAt}
	r.invites = append(r.invites, fakeInvite{Invite: i, hash: tokenHash})
	return i, nil
}

func (r *fakeInviteRepo) ListActiveInvites(_ context.Context, groupID uuid.UUID, now time.Time) ([]Invite, error) {
	return r.active(groupID, now), nil
}

func (r *fakeInviteRepo) CountActiveInvites(_ context.Context, groupID uuid.UUID, now time.Time) (int, error) {
	return len(r.active(groupID, now)), nil
}

func (r *fakeInviteRepo) RevokeInvite(_ context.Context, groupID, inviteID uuid.UUID, _ time.Time) error {
	for i := range r.invites {
		if r.invites[i].ID == inviteID && r.invites[i].GroupID == groupID && !r.invites[i].revoked {
			r.invites[i].revoked = true
			return nil
		}
	}
	return ErrInviteNotFound
}

func (r *fakeInviteRepo) FindInvite(_ context.Context, tokenHash []byte) (InviteTarget, error) {
	for _, i := range r.invites {
		if bytes.Equal(i.hash, tokenHash) {
			return InviteTarget{Group: r.groups[i.GroupID], ExpiresAt: i.ExpiresAt, Revoked: i.revoked}, nil
		}
	}
	return InviteTarget{}, ErrInviteNotFound
}

// PreviewMembers invents anonymous members: the tests only look at counts.
func (r *fakeInviteRepo) PreviewMembers(_ context.Context, groupID uuid.UUID, max int) (int, []PreviewMember, error) {
	count := len(r.roles[groupID])
	members := make([]PreviewMember, min(count, max))
	for i := range members {
		members[i] = PreviewMember{FirstName: "Member"}
	}
	return count, members, nil
}

func (r *fakeInviteRepo) AddMemberIfAbsent(_ context.Context, groupID, userID uuid.UUID, role Role) (bool, error) {
	if _, ok := r.roles[groupID][userID]; ok {
		return false, nil
	}
	r.roles[groupID][userID] = role
	return true, nil
}

// inviteFixture is one group with an owner, an admin and a member, a second
// group the others are not in, and a clock the tests can move.
type inviteFixture struct {
	repo                                  *fakeInviteRepo
	pub                                   *fakePublisher
	svc                                   *InviteService
	now                                   time.Time
	group, otherGroup                     uuid.UUID
	owner, admin, member, outsider, guest uuid.UUID
}

func newInviteFixture(t *testing.T) *inviteFixture {
	t.Helper()
	f := &inviteFixture{
		now:        inviteNow,
		group:      uuid.New(),
		otherGroup: uuid.New(),
		owner:      uuid.New(),
		admin:      uuid.New(),
		member:     uuid.New(),
		outsider:   uuid.New(),
		guest:      uuid.New(),
	}
	f.pub = &fakePublisher{}
	f.repo = &fakeInviteRepo{
		roles: map[uuid.UUID]map[uuid.UUID]Role{
			f.group:      {f.owner: RoleOwner, f.admin: RoleAdmin, f.member: RoleMember},
			f.otherGroup: {f.outsider: RoleOwner},
		},
		groups: map[uuid.UUID]Group{
			f.group:      {ID: f.group, Name: "WG Kaiserstraße"},
			f.otherGroup: {ID: f.otherGroup, Name: "Andere"},
		},
	}
	f.svc = NewInviteService(f.repo, f.pub)
	f.svc.now = func() time.Time { return f.now }
	return f
}

func TestInviteService_Create(t *testing.T) {
	tests := []struct {
		name    string
		actor   func(f *inviteFixture) uuid.UUID
		wantErr error
	}{
		{name: "owner", actor: func(f *inviteFixture) uuid.UUID { return f.owner }},
		{name: "admin", actor: func(f *inviteFixture) uuid.UUID { return f.admin }},
		{name: "member", actor: func(f *inviteFixture) uuid.UUID { return f.member }, wantErr: ErrForbidden},
		{name: "outsider", actor: func(f *inviteFixture) uuid.UUID { return f.outsider }, wantErr: ErrNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := newInviteFixture(t)

			token, invite, err := f.svc.Create(context.Background(), tt.actor(f), f.group)

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Create() error = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr != nil {
				if token != "" || len(f.repo.invites) != 0 {
					t.Errorf("rejected Create() left token %q and %d invites", token, len(f.repo.invites))
				}
				return
			}
			if token == "" {
				t.Fatal("token is empty")
			}
			if want := f.now.Add(7 * 24 * time.Hour); !invite.ExpiresAt.Equal(want) {
				t.Errorf("ExpiresAt = %v, want %v", invite.ExpiresAt, want)
			}
			// Only the hash is stored, never the token itself.
			if len(f.repo.invites) != 1 || !bytes.Equal(f.repo.invites[0].hash, hashInviteToken(token)) {
				t.Errorf("stored invites = %+v, want one with the hash of the token", f.repo.invites)
			}
			if bytes.Contains(f.repo.invites[0].hash, []byte(token)) {
				t.Error("stored hash contains the token")
			}
		})
	}

	t.Run("tokens differ", func(t *testing.T) {
		f := newInviteFixture(t)
		a, _, errA := f.svc.Create(context.Background(), f.owner, f.group)
		b, _, errB := f.svc.Create(context.Background(), f.owner, f.group)
		if errA != nil || errB != nil {
			t.Fatalf("Create() errors = %v, %v", errA, errB)
		}
		if a == b {
			t.Errorf("two invites got the same token %q", a)
		}
	})

	t.Run("limit of open invites", func(t *testing.T) {
		f := newInviteFixture(t)
		for range MaxActiveInvites {
			if _, _, err := f.svc.Create(context.Background(), f.owner, f.group); err != nil {
				t.Fatalf("Create() error = %v", err)
			}
		}

		_, _, err := f.svc.Create(context.Background(), f.owner, f.group)
		if !errors.Is(err, ErrTooManyInvites) {
			t.Fatalf("Create() over the limit error = %v, want %v", err, ErrTooManyInvites)
		}

		// Expired invites do not count, so waiting frees the slots.
		f.now = f.now.Add(8 * 24 * time.Hour)
		if _, _, err := f.svc.Create(context.Background(), f.owner, f.group); err != nil {
			t.Errorf("Create() after expiry error = %v", err)
		}
	})
}

func TestInviteService_ListAndRevoke(t *testing.T) {
	ctx := context.Background()

	t.Run("list shows only active invites", func(t *testing.T) {
		f := newInviteFixture(t)
		_, kept, _ := f.svc.Create(ctx, f.owner, f.group)
		_, revoked, _ := f.svc.Create(ctx, f.owner, f.group)
		if err := f.svc.Revoke(ctx, f.admin, f.group, revoked.ID); err != nil {
			t.Fatalf("Revoke() error = %v", err)
		}

		got, err := f.svc.List(ctx, f.admin, f.group)
		if err != nil {
			t.Fatalf("List() error = %v", err)
		}
		if len(got) != 1 || got[0].ID != kept.ID {
			t.Errorf("List() = %+v, want only %v", got, kept.ID)
		}

		f.now = f.now.Add(8 * 24 * time.Hour)
		got, err = f.svc.List(ctx, f.admin, f.group)
		if err != nil || len(got) != 0 {
			t.Errorf("List() after expiry = %+v, %v; want none", got, err)
		}
	})

	t.Run("members and outsiders cannot list or revoke", func(t *testing.T) {
		f := newInviteFixture(t)
		_, invite, _ := f.svc.Create(ctx, f.owner, f.group)

		if _, err := f.svc.List(ctx, f.member, f.group); !errors.Is(err, ErrForbidden) {
			t.Errorf("member List() error = %v, want %v", err, ErrForbidden)
		}
		if _, err := f.svc.List(ctx, f.outsider, f.group); !errors.Is(err, ErrNotFound) {
			t.Errorf("outsider List() error = %v, want %v", err, ErrNotFound)
		}
		if err := f.svc.Revoke(ctx, f.member, f.group, invite.ID); !errors.Is(err, ErrForbidden) {
			t.Errorf("member Revoke() error = %v, want %v", err, ErrForbidden)
		}
		if err := f.svc.Revoke(ctx, f.outsider, f.group, invite.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("outsider Revoke() error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("revoke only reaches the invites of the own group", func(t *testing.T) {
		f := newInviteFixture(t)
		_, foreign, err := f.svc.Create(ctx, f.outsider, f.otherGroup)
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		if err := f.svc.Revoke(ctx, f.owner, f.group, foreign.ID); !errors.Is(err, ErrInviteNotFound) {
			t.Errorf("Revoke() error = %v, want %v", err, ErrInviteNotFound)
		}
		if got := f.repo.active(f.otherGroup, f.now); len(got) != 1 {
			t.Errorf("foreign invite was revoked: %+v", got)
		}
	})

	t.Run("revoking twice", func(t *testing.T) {
		f := newInviteFixture(t)
		_, invite, _ := f.svc.Create(ctx, f.owner, f.group)
		if err := f.svc.Revoke(ctx, f.owner, f.group, invite.ID); err != nil {
			t.Fatalf("Revoke() error = %v", err)
		}
		if err := f.svc.Revoke(ctx, f.owner, f.group, invite.ID); !errors.Is(err, ErrInviteNotFound) {
			t.Errorf("second Revoke() error = %v, want %v", err, ErrInviteNotFound)
		}
	})
}

func TestInviteService_PreviewAndAccept(t *testing.T) {
	ctx := context.Background()

	// newToken returns a fresh token plus the invite it belongs to.
	newToken := func(t *testing.T, f *inviteFixture) (string, Invite) {
		t.Helper()
		token, invite, err := f.svc.Create(ctx, f.owner, f.group)
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		return token, invite
	}

	t.Run("preview names the group", func(t *testing.T) {
		f := newInviteFixture(t)
		token, _ := newToken(t, f)

		got, err := f.svc.Preview(ctx, token)
		if err != nil || got.GroupName != "WG Kaiserstraße" {
			t.Errorf("Preview() = %+v, %v", got, err)
		}
		if got.MemberCount != 3 || len(got.Members) != 3 {
			t.Errorf("members = %d counted, %d named; want 3 and 3", got.MemberCount, len(got.Members))
		}
	})

	t.Run("preview names only the first few members", func(t *testing.T) {
		f := newInviteFixture(t)
		token, _ := newToken(t, f)
		for range 3 {
			if _, err := f.svc.Accept(ctx, uuid.New(), token); err != nil {
				t.Fatalf("Accept() error = %v", err)
			}
		}

		got, err := f.svc.Preview(ctx, token)

		if err != nil || got.MemberCount != 6 || len(got.Members) != PreviewMemberLimit {
			t.Errorf("Preview() counted %d, named %d (error %v); want 6 and %d",
				got.MemberCount, len(got.Members), err, PreviewMemberLimit)
		}
	})

	t.Run("accept adds a plain member", func(t *testing.T) {
		f := newInviteFixture(t)
		token, _ := newToken(t, f)

		g, err := f.svc.Accept(ctx, f.guest, token)

		if err != nil || g.ID != f.group {
			t.Fatalf("Accept() = %+v, %v", g, err)
		}
		if role := f.repo.roles[f.group][f.guest]; role != RoleMember {
			t.Errorf("role = %q, want %q", role, RoleMember)
		}
		if want := []string{"joined " + f.group.String() + " " + f.guest.String()}; !slices.Equal(f.pub.events, want) {
			t.Errorf("published %v, want %v", f.pub.events, want)
		}

		// The same person with the same link again is not news.
		f.pub.events = nil
		if _, err := f.svc.Accept(ctx, f.guest, token); err != nil {
			t.Fatalf("second Accept() error = %v", err)
		}
		if len(f.pub.events) != 0 {
			t.Errorf("second Accept() published %v, want nothing", f.pub.events)
		}
	})

	t.Run("the link works for several people", func(t *testing.T) {
		f := newInviteFixture(t)
		token, _ := newToken(t, f)

		for _, user := range []uuid.UUID{f.guest, f.outsider} {
			if _, err := f.svc.Accept(ctx, user, token); err != nil {
				t.Errorf("Accept() for %v error = %v", user, err)
			}
		}
	})

	t.Run("accepting as an existing member changes nothing", func(t *testing.T) {
		f := newInviteFixture(t)
		token, _ := newToken(t, f)

		for _, user := range []uuid.UUID{f.admin, f.owner} {
			role := f.repo.roles[f.group][user]
			if _, err := f.svc.Accept(ctx, user, token); err != nil {
				t.Fatalf("Accept() error = %v", err)
			}
			if got := f.repo.roles[f.group][user]; got != role {
				t.Errorf("role = %q, want it to stay %q", got, role)
			}
		}
		if len(f.pub.events) != 0 {
			t.Errorf("published %v, want nothing", f.pub.events)
		}
	})

	t.Run("expired", func(t *testing.T) {
		tests := []struct {
			name  string
			after time.Duration
		}{
			{name: "just before expiry works", after: 7*24*time.Hour - time.Nanosecond},
			{name: "at expiry", after: 7 * 24 * time.Hour},
			{name: "after expiry", after: 8 * 24 * time.Hour},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				f := newInviteFixture(t)
				token, _ := newToken(t, f)
				f.now = f.now.Add(tt.after)

				_, err := f.svc.Accept(ctx, f.guest, token)

				wantExpired := tt.after >= 7*24*time.Hour
				if wantExpired != errors.Is(err, ErrInviteExpired) {
					t.Errorf("Accept() error = %v, want expired = %v", err, wantExpired)
				}
				_, joined := f.repo.roles[f.group][f.guest]
				if joined == wantExpired {
					t.Errorf("guest joined = %v, want %v", joined, !wantExpired)
				}
				if published := len(f.pub.events) > 0; published != joined {
					t.Errorf("published %v, but guest joined = %v", f.pub.events, joined)
				}
			})
		}
	})

	t.Run("revoked", func(t *testing.T) {
		f := newInviteFixture(t)
		token, invite := newToken(t, f)
		if err := f.svc.Revoke(ctx, f.owner, f.group, invite.ID); err != nil {
			t.Fatalf("Revoke() error = %v", err)
		}

		if _, err := f.svc.Accept(ctx, f.guest, token); !errors.Is(err, ErrInviteExpired) {
			t.Errorf("Accept() error = %v, want %v", err, ErrInviteExpired)
		}
		if _, err := f.svc.Preview(ctx, token); !errors.Is(err, ErrInviteExpired) {
			t.Errorf("Preview() error = %v, want %v", err, ErrInviteExpired)
		}
	})

	t.Run("unknown and empty tokens", func(t *testing.T) {
		f := newInviteFixture(t)
		newToken(t, f)

		for _, token := range []string{"", "nope", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"} {
			if _, err := f.svc.Accept(ctx, f.guest, token); !errors.Is(err, ErrInviteNotFound) {
				t.Errorf("Accept(%q) error = %v, want %v", token, err, ErrInviteNotFound)
			}
		}
		if _, joined := f.repo.roles[f.group][f.guest]; joined {
			t.Error("guest joined with a wrong token")
		}
		if len(f.pub.events) != 0 {
			t.Errorf("published %v, want nothing", f.pub.events)
		}
	})
}

func TestFirstName(t *testing.T) {
	tests := map[string]string{
		"Anna Müller":      "Anna",
		"Anna":             "Anna",
		"  Anna  Müller ":  "Anna",
		"Anna-Lena Meyer":  "Anna-Lena",
		"":                 "",
		"anna@example.com": "anna@example.com",
	}
	for in, want := range tests {
		if got := firstName(in); got != want {
			t.Errorf("firstName(%q) = %q, want %q", in, got, want)
		}
	}
}
