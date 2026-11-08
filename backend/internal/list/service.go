package list

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"mitbringsel/internal/group"
)

// Service holds the rules for lists. Every method takes the acting user
// (actor) and checks what they may do, so a handler cannot forget it.
//
// Every member may create, rename and archive lists. Deleting also removes
// all items, so only the owner and admins may do it.
type Service struct {
	repo    Repository
	members MemberLookup
}

// NewService returns a service backed by the given repository. members is
// usually the group repository.
func NewService(repo Repository, members MemberLookup) *Service {
	return &Service{repo: repo, members: members}
}

// Create adds a list to the group.
func (s *Service) Create(ctx context.Context, actor, groupID uuid.UUID, name string) (List, error) {
	// Membership first: an outsider must not learn anything about the
	// rules, not even that the name was invalid.
	if _, err := s.roleIn(ctx, groupID, actor); err != nil {
		return List{}, err
	}
	name, err := normalizeName(name)
	if err != nil {
		return List{}, err
	}
	l, err := s.repo.Create(ctx, groupID, name)
	if err != nil {
		return List{}, fmt.Errorf("create list: %w", err)
	}
	return l, nil
}

// ListForGroup returns the group's lists, oldest first. Archived lists are
// only included if includeArchived is true.
func (s *Service) ListForGroup(ctx context.Context, actor, groupID uuid.UUID, includeArchived bool) ([]List, error) {
	if _, err := s.roleIn(ctx, groupID, actor); err != nil {
		return nil, err
	}
	lists, err := s.repo.ListForGroup(ctx, groupID, includeArchived)
	if err != nil {
		return nil, fmt.Errorf("list lists: %w", err)
	}
	return lists, nil
}

// Get returns one list.
func (s *Service) Get(ctx context.Context, actor, listID uuid.UUID) (List, error) {
	l, _, err := s.find(ctx, actor, listID)
	return l, err
}

// Rename changes the name of a list.
func (s *Service) Rename(ctx context.Context, actor, listID uuid.UUID, name string) (List, error) {
	if _, _, err := s.find(ctx, actor, listID); err != nil {
		return List{}, err
	}
	name, err := normalizeName(name)
	if err != nil {
		return List{}, err
	}
	l, err := s.repo.Rename(ctx, listID, name)
	if err != nil {
		return List{}, fmt.Errorf("rename list: %w", err)
	}
	return l, nil
}

// Archive hides a list from the normal view without deleting it.
func (s *Service) Archive(ctx context.Context, actor, listID uuid.UUID) (List, error) {
	return s.setArchived(ctx, actor, listID, true)
}

// Unarchive brings an archived list back.
func (s *Service) Unarchive(ctx context.Context, actor, listID uuid.UUID) (List, error) {
	return s.setArchived(ctx, actor, listID, false)
}

func (s *Service) setArchived(ctx context.Context, actor, listID uuid.UUID, archived bool) (List, error) {
	if _, _, err := s.find(ctx, actor, listID); err != nil {
		return List{}, err
	}
	l, err := s.repo.SetArchived(ctx, listID, archived)
	if err != nil {
		return List{}, fmt.Errorf("set list archived: %w", err)
	}
	return l, nil
}

// Delete removes a list and all its items. Only the owner and admins of the
// group may do this.
func (s *Service) Delete(ctx context.Context, actor, listID uuid.UUID) error {
	_, role, err := s.find(ctx, actor, listID)
	if err != nil {
		return err
	}
	if role != group.RoleOwner && role != group.RoleAdmin {
		return ErrForbidden
	}
	if err := s.repo.Delete(ctx, listID); err != nil {
		return fmt.Errorf("delete list: %w", err)
	}
	return nil
}

// find loads a list and the actor's role in its group. It returns
// ErrNotFound if the list does not exist or the actor is not a member.
func (s *Service) find(ctx context.Context, actor, listID uuid.UUID) (List, group.Role, error) {
	l, err := s.repo.Get(ctx, listID)
	if errors.Is(err, ErrNotFound) {
		return List{}, "", ErrNotFound
	}
	if err != nil {
		return List{}, "", fmt.Errorf("get list: %w", err)
	}
	role, err := s.roleIn(ctx, l.GroupID, actor)
	if err != nil {
		return List{}, "", err
	}
	return l, role, nil
}

// roleIn returns the user's role in the group, or ErrNotFound if they are
// not a member (or the group does not exist).
func (s *Service) roleIn(ctx context.Context, groupID, userID uuid.UUID) (group.Role, error) {
	role, err := s.members.MemberRole(ctx, groupID, userID)
	if errors.Is(err, group.ErrNotFound) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("get member role: %w", err)
	}
	return role, nil
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
