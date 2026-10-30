package group

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Service holds the rules for groups. Every method takes the acting user
// (actor) and checks what they may do, so a handler cannot forget it.
type Service struct {
	repo Repository
}

// NewService returns a service backed by the given repository.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// Create makes a new group with the actor as its only member and owner.
func (s *Service) Create(ctx context.Context, actor uuid.UUID, name string) (Details, error) {
	name, err := normalizeName(name)
	if err != nil {
		return Details{}, err
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

// Rename changes the group's name. Owners only.
func (s *Service) Rename(ctx context.Context, actor, groupID uuid.UUID, name string) (Group, error) {
	name, err := normalizeName(name)
	if err != nil {
		return Group{}, err
	}
	if err := requireOwner(ctx, s.repo, groupID, actor); err != nil {
		return Group{}, err
	}
	g, err := s.repo.Rename(ctx, groupID, name)
	if err != nil {
		return Group{}, fmt.Errorf("rename group: %w", err)
	}
	return g, nil
}

// Delete removes the group with all its members. Owners only.
func (s *Service) Delete(ctx context.Context, actor, groupID uuid.UUID) error {
	if err := requireOwner(ctx, s.repo, groupID, actor); err != nil {
		return err
	}
	if err := s.repo.Delete(ctx, groupID); err != nil {
		return fmt.Errorf("delete group: %w", err)
	}
	return nil
}

// RemoveMember takes userID out of the group. Everyone may remove
// themselves (leave); removing someone else needs an owner. The last owner
// can do neither for themselves: see ErrLastOwner.
func (s *Service) RemoveMember(ctx context.Context, actor, groupID, userID uuid.UUID) error {
	return s.repo.InTx(ctx, func(tx Repository) error {
		// Locked first, so the owner count below cannot change before the
		// removal is committed.
		if err := tx.Lock(ctx, groupID); err != nil {
			return fmt.Errorf("lock group: %w", err)
		}
		actorRole, err := roleOf(ctx, tx, groupID, actor)
		if err != nil {
			return err
		}
		if userID != actor && actorRole != RoleOwner {
			return ErrForbidden
		}

		targetRole, err := roleOf(ctx, tx, groupID, userID)
		if err != nil {
			return err
		}
		if targetRole == RoleOwner {
			if err := ensureAnotherOwner(ctx, tx, groupID); err != nil {
				return err
			}
		}

		if err := tx.RemoveMember(ctx, groupID, userID); err != nil {
			return fmt.Errorf("remove member: %w", err)
		}
		return nil
	})
}

// SetRole makes userID an owner or a plain member. Owners only; the last
// owner cannot step down (ErrLastOwner).
func (s *Service) SetRole(ctx context.Context, actor, groupID, userID uuid.UUID, role Role) error {
	if !role.valid() {
		return ErrInvalidRole
	}
	return s.repo.InTx(ctx, func(tx Repository) error {
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
		if current == role {
			return nil
		}
		if current == RoleOwner {
			if err := ensureAnotherOwner(ctx, tx, groupID); err != nil {
				return err
			}
		}

		if err := tx.SetRole(ctx, groupID, userID, role); err != nil {
			return fmt.Errorf("set role: %w", err)
		}
		return nil
	})
}

// roleOf returns the user's role in the group, or ErrNotFound if they are
// not a member (or the group does not exist).
func roleOf(ctx context.Context, repo Repository, groupID, userID uuid.UUID) (Role, error) {
	role, err := repo.MemberRole(ctx, groupID, userID)
	if errors.Is(err, ErrNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get member role: %w", err)
	}
	return role, nil
}

func requireOwner(ctx context.Context, repo Repository, groupID, actor uuid.UUID) error {
	role, err := roleOf(ctx, repo, groupID, actor)
	if err != nil {
		return err
	}
	if role != RoleOwner {
		return ErrForbidden
	}
	return nil
}

// ensureAnotherOwner fails with ErrLastOwner unless the group has more than
// one owner, i.e. one owner can go and another one stays.
func ensureAnotherOwner(ctx context.Context, repo Repository, groupID uuid.UUID) error {
	owners, err := repo.CountOwners(ctx, groupID)
	if err != nil {
		return fmt.Errorf("count owners: %w", err)
	}
	if owners <= 1 {
		return ErrLastOwner
	}
	return nil
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
