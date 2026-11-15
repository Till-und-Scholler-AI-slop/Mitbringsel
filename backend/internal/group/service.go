package group

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Publisher tells the members of a group about a change once it is committed.
// It is best effort: it must not block and has no error to return, because
// the change is stored either way. ctx is the request's and may be cancelled
// at any moment, so an implementation must not depend on it staying alive
// (use context.WithoutCancel for work that outlives the request).
//
// The methods say what happened, not what to send: moving connections in and
// out of the group's room is part of the job, and the order inside a method
// matters to the implementation.
type Publisher interface {
	// GroupChanged is called when the name or a role changed. It is only a
	// hint to reload the groups.
	GroupChanged(ctx context.Context, groupID, actor uuid.UUID)
	// MemberJoined is called when userID became a member, by creating the
	// group or by accepting an invite. userID is also the actor.
	MemberJoined(ctx context.Context, groupID, userID uuid.UUID)
	// MemberRemoved is called when userID left (actor == userID) or was
	// removed by actor.
	MemberRemoved(ctx context.Context, groupID, actor, userID uuid.UUID)
	// GroupDeleted is called when the group is gone with its lists, items
	// and members.
	GroupDeleted(ctx context.Context, groupID, actor uuid.UUID)
}

// noPublisher is the Publisher for callers without live connections (the
// seed command, tests). It does nothing.
type noPublisher struct{}

func (noPublisher) GroupChanged(context.Context, uuid.UUID, uuid.UUID)             {}
func (noPublisher) MemberJoined(context.Context, uuid.UUID, uuid.UUID)             {}
func (noPublisher) MemberRemoved(context.Context, uuid.UUID, uuid.UUID, uuid.UUID) {}
func (noPublisher) GroupDeleted(context.Context, uuid.UUID, uuid.UUID)             {}

// Service holds the rules for groups. Every method takes the acting user
// (actor) and checks what they may do, so a handler cannot forget it.
type Service struct {
	repo Repository
	pub  Publisher
}

// NewService returns a service backed by the given repository. pub is told
// about every change after it is committed; nil means nobody listens.
func NewService(repo Repository, pub Publisher) *Service {
	if pub == nil {
		pub = noPublisher{}
	}
	return &Service{repo: repo, pub: pub}
}

// Create makes a new group with the actor as its only member and owner.
func (s *Service) Create(ctx context.Context, actor uuid.UUID, name string) (Details, error) {
	name, err := normalizeName(name)
	if err != nil {
		return Details{}, err
	}

	// Two requests at the same moment can both pass this check and exceed
	// the limit by one. The limit only keeps the table small, so that is
	// not worth a lock (like MaxActiveInvites).
	owned, err := s.repo.CountOwned(ctx, actor)
	if err != nil {
		return Details{}, fmt.Errorf("count owned groups: %w", err)
	}
	if owned >= MaxOwnedGroups {
		return Details{}, ErrTooManyGroups
	}

	var groupID uuid.UUID
	// One transaction: a group without its owner must never be stored.
	err = s.repo.InTx(ctx, func(tx Repository) error {
		g, err := tx.Create(ctx, name, actor)
		if err != nil {
			return fmt.Errorf("create group: %w", err)
		}
		groupID = g.ID
		if err := tx.AddMember(ctx, g.ID, actor, RoleOwner); err != nil {
			return fmt.Errorf("add owner: %w", err)
		}
		return nil
	})
	if err != nil {
		return Details{}, err
	}
	// Before Get: if Get fails, the group exists all the same, and the
	// creator's connections must be in its room.
	s.pub.MemberJoined(ctx, groupID, actor)
	return s.Get(ctx, actor, groupID)
}

// List returns all groups the actor is a member of, with their members.
func (s *Service) List(ctx context.Context, actor uuid.UUID) ([]Details, error) {
	memberships, err := s.repo.ListForUser(ctx, actor)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
	}
	if len(memberships) == 0 {
		return []Details{}, nil
	}

	ids := make([]uuid.UUID, len(memberships))
	for i, m := range memberships {
		ids[i] = m.Group.ID
	}
	members, err := s.repo.Members(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list members: %w", err)
	}

	out := make([]Details, len(memberships))
	for i, m := range memberships {
		out[i] = Details{Group: m.Group, Role: m.Role, Members: members[m.Group.ID]}
	}
	return out, nil
}

// GroupIDs returns the IDs of the groups the actor is a member of. It is
// List without the members, for callers that only need to know where the
// actor belongs, such as the live connection.
func (s *Service) GroupIDs(ctx context.Context, actor uuid.UUID) ([]uuid.UUID, error) {
	memberships, err := s.repo.ListForUser(ctx, actor)
	if err != nil {
		return nil, fmt.Errorf("list groups: %w", err)
	}

	// make instead of a nil slice, so "no groups" is empty and not nil.
	ids := make([]uuid.UUID, len(memberships))
	for i, m := range memberships {
		ids[i] = m.Group.ID
	}
	return ids, nil
}

// Get returns one group. Non-members get ErrNotFound.
func (s *Service) Get(ctx context.Context, actor, groupID uuid.UUID) (Details, error) {
	role, err := roleOf(ctx, s.repo, groupID, actor)
	if err != nil {
		return Details{}, err
	}
	g, err := s.repo.Get(ctx, groupID)
	if err != nil {
		return Details{}, fmt.Errorf("get group: %w", err)
	}
	members, err := s.repo.Members(ctx, []uuid.UUID{groupID})
	if err != nil {
		return Details{}, fmt.Errorf("list members: %w", err)
	}
	return Details{Group: g, Role: role, Members: members[groupID]}, nil
}

// Rename changes the group's name. Owner and admins. Giving it the name it
// has already changes nothing: no write, no event.
func (s *Service) Rename(ctx context.Context, actor, groupID uuid.UUID, name string) (Group, error) {
	name, err := normalizeName(name)
	if err != nil {
		return Group{}, err
	}
	if err := requireManager(ctx, s.repo, groupID, actor); err != nil {
		return Group{}, err
	}
	// The check reads the group before writing, so a rename that races with
	// another one may skip or repeat a write. That is fine: the request
	// counts as executed at the moment of the read.
	current, err := s.repo.Get(ctx, groupID)
	if err != nil {
		return Group{}, fmt.Errorf("get group: %w", err)
	}
	if current.Name == name {
		return current, nil
	}
	g, err := s.repo.Rename(ctx, groupID, name)
	if err != nil {
		return Group{}, fmt.Errorf("rename group: %w", err)
	}
	s.pub.GroupChanged(ctx, groupID, actor)
	return g, nil
}

// Delete removes the group with all its members. Owner only.
func (s *Service) Delete(ctx context.Context, actor, groupID uuid.UUID) error {
	if err := requireOwner(ctx, s.repo, groupID, actor); err != nil {
		return err
	}
	if err := s.repo.Delete(ctx, groupID); err != nil {
		return fmt.Errorf("delete group: %w", err)
	}
	// The lists and items go with the group without events of their own:
	// clients drop them together with the group.
	s.pub.GroupDeleted(ctx, groupID, actor)
	return nil
}

// RemoveMember takes userID out of the group. Everyone but the owner may
// remove themselves (leave). Removing someone else needs a higher role: the
// owner removes admins and members, an admin only plain members.
func (s *Service) RemoveMember(ctx context.Context, actor, groupID, userID uuid.UUID) error {
	err := s.repo.InTx(ctx, func(tx Repository) error {
		// Locked first, so the roles checked below cannot change before the
		// removal is committed.
		if err := tx.Lock(ctx, groupID); err != nil {
			return fmt.Errorf("lock group: %w", err)
		}
		actorRole, err := roleOf(ctx, tx, groupID, actor)
		if err != nil {
			return err
		}

		if userID == actor {
			if actorRole == RoleOwner {
				return ErrOwnerImmutable
			}
		} else {
			// A plain member is stopped before we look at the target, so
			// they cannot probe who is in the group.
			if actorRole == RoleMember {
				return ErrForbidden
			}
			targetRole, err := roleOf(ctx, tx, groupID, userID)
			if err != nil {
				return err
			}
			if !mayRemove(actorRole, targetRole) {
				return ErrForbidden
			}
		}

		if err := tx.RemoveMember(ctx, groupID, userID); err != nil {
			return fmt.Errorf("remove member: %w", err)
		}
		return nil
	})
	if err != nil {
		return err
	}
	s.pub.MemberRemoved(ctx, groupID, actor, userID)
	return nil
}

// SetRole makes userID an admin or a plain member. Owner only. The owner's
// own role never changes (ErrOwnerImmutable), and nobody else can become
// owner (ErrInvalidRole).
func (s *Service) SetRole(ctx context.Context, actor, groupID, userID uuid.UUID, role Role) error {
	if !role.assignable() {
		return ErrInvalidRole
	}
	// changed stays false when the member has the role already: nothing is
	// written then, and nothing is published.
	var changed bool
	err := s.repo.InTx(ctx, func(tx Repository) error {
		if err := tx.Lock(ctx, groupID); err != nil {
			return fmt.Errorf("lock group: %w", err)
		}
		if err := requireOwner(ctx, tx, groupID, actor); err != nil {
			return err
		}

		current, err := roleOf(ctx, tx, groupID, userID)
		if err != nil {
			return err
		}
		if current == RoleOwner {
			return ErrOwnerImmutable
		}
		if current == role {
			return nil
		}

		if err := tx.SetRole(ctx, groupID, userID, role); err != nil {
			return fmt.Errorf("set role: %w", err)
		}
		changed = true
		return nil
	})
	if err != nil {
		return err
	}
	if changed {
		s.pub.GroupChanged(ctx, groupID, actor)
	}
	return nil
}

// roleLookup is the one repository method the permission checks need, so
// the invite service can use them with its own, smaller repository.
type roleLookup interface {
	MemberRole(ctx context.Context, groupID, userID uuid.UUID) (Role, error)
}

// roleOf returns the user's role in the group, or ErrNotFound if they are
// not a member (or the group does not exist).
func roleOf(ctx context.Context, repo roleLookup, groupID, userID uuid.UUID) (Role, error) {
	role, err := repo.MemberRole(ctx, groupID, userID)
	if errors.Is(err, ErrNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get member role: %w", err)
	}
	return role, nil
}

func requireOwner(ctx context.Context, repo roleLookup, groupID, actor uuid.UUID) error {
	role, err := roleOf(ctx, repo, groupID, actor)
	if err != nil {
		return err
	}
	if role != RoleOwner {
		return ErrForbidden
	}
	return nil
}

// requireManager lets owner and admins through; they run the group together.
func requireManager(ctx context.Context, repo roleLookup, groupID, actor uuid.UUID) error {
	role, err := roleOf(ctx, repo, groupID, actor)
	if err != nil {
		return err
	}
	if role != RoleOwner && role != RoleAdmin {
		return ErrForbidden
	}
	return nil
}

// mayRemove reports whether someone with the actor role may remove someone
// else with the target role from the group.
func mayRemove(actor, target Role) bool {
	switch actor {
	case RoleOwner:
		return target != RoleOwner
	case RoleAdmin:
		return target == RoleMember
	default:
		return false
	}
}

// normalizeName trims the name and checks its length in characters.
func normalizeName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("%w: name is empty", ErrInvalidName)
	}
	if utf8.RuneCountInString(name) > MaxNameLength {
		return "", fmt.Errorf("%w: name is longer than %d characters", ErrInvalidName, MaxNameLength)
	}
	return name, nil
}
