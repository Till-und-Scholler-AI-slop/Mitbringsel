package list

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"tuolino/internal/group"
)

// Publisher tells the members of a group about a list change once it is
// stored. It is best effort: it must not block and has no error to return,
// because the change is stored either way. ctx is the request's and may be
// cancelled at any moment, so an implementation must not depend on it staying
// alive (use context.WithoutCancel for work that outlives the request).
type Publisher interface {
	// ListChanged gets the list as stored after a create, update, archive
	// or unarchive.
	ListChanged(ctx context.Context, actor uuid.UUID, l List)
	// ListDeleted gets the list as it was before the deletion; ID and
	// GroupID are what matters.
	ListDeleted(ctx context.Context, actor uuid.UUID, l List)
}

// noPublisher is the Publisher for callers without live connections (the
// seed command, tests). It does nothing.
type noPublisher struct{}

func (noPublisher) ListChanged(context.Context, uuid.UUID, List) {}
func (noPublisher) ListDeleted(context.Context, uuid.UUID, List) {}

// Service holds the rules for lists. Every method takes the acting user
// (actor) and checks what they may do, so a handler cannot forget it.
//
// Every member may create, rename and archive lists. Deleting also removes
// all items, so only the owner and admins may do it.
type Service struct {
	repo    Repository
	members MemberLookup
	pub     Publisher
}

// NewService returns a service backed by the given repository. members is
// usually the group repository. pub is told about every change after it is
// stored; nil means nobody listens.
func NewService(repo Repository, members MemberLookup, pub Publisher) *Service {
	if pub == nil {
		pub = noPublisher{}
	}
	return &Service{repo: repo, members: members, pub: pub}
}

// Create adds a list to the group. An empty icon means DefaultIcon.
func (s *Service) Create(ctx context.Context, actor, groupID uuid.UUID, name string, icon Icon) (List, error) {
	// Membership first: an outsider must not learn anything about the
	// rules, not even that the name was invalid.
	if _, err := s.roleIn(ctx, groupID, actor); err != nil {
		return List{}, err
	}
	name, err := normalizeName(name)
	if err != nil {
		return List{}, err
	}
	icon, err = checkIcon(icon, DefaultIcon)
	if err != nil {
		return List{}, err
	}
	// Two requests at the same moment can both pass this check and exceed
	// the limit by one. The limit only keeps the table small, so that is
	// not worth a lock (like group.MaxOwnedGroups).
	count, err := s.repo.CountForGroup(ctx, groupID)
	if err != nil {
		return List{}, fmt.Errorf("count lists: %w", err)
	}
	if count >= MaxListsPerGroup {
		return List{}, ErrTooManyLists
	}
	l, err := s.repo.Create(ctx, groupID, name, icon)
	if err != nil {
		return List{}, fmt.Errorf("create list: %w", err)
	}
	s.pub.ListChanged(ctx, actor, l)
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

// Update changes the name and icon of a list. An empty icon keeps the
// current one. Giving it the values it has already changes nothing: no
// write, no new serverSeq, no event.
func (s *Service) Update(ctx context.Context, actor, listID uuid.UUID, name string, icon Icon) (List, error) {
	current, _, err := s.find(ctx, actor, listID)
	if err != nil {
		return List{}, err
	}
	name, err = normalizeName(name)
	if err != nil {
		return List{}, err
	}
	icon, err = checkIcon(icon, current.Icon)
	if err != nil {
		return List{}, err
	}
	// The check reads the list before writing, so an update that races with
	// another one may skip or repeat a write. That is fine: the request
	// counts as executed at the moment of the read.
	if current.Name == name && current.Icon == icon {
		return current, nil
	}
	l, err := s.repo.Update(ctx, listID, name, icon)
	if err != nil {
		return List{}, fmt.Errorf("update list: %w", err)
	}
	s.pub.ListChanged(ctx, actor, l)
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

// setArchived does nothing if the list is in the wanted state already (the
// read-then-write caveat of Update applies).
func (s *Service) setArchived(ctx context.Context, actor, listID uuid.UUID, archived bool) (List, error) {
	current, _, err := s.find(ctx, actor, listID)
	if err != nil {
		return List{}, err
	}
	if current.Archived() == archived {
		return current, nil
	}
	l, err := s.repo.SetArchived(ctx, listID, archived)
	if err != nil {
		return List{}, fmt.Errorf("set list archived: %w", err)
	}
	s.pub.ListChanged(ctx, actor, l)
	return l, nil
}

// Delete removes a list and all its items. Only the owner and admins of the
// group may do this.
func (s *Service) Delete(ctx context.Context, actor, listID uuid.UUID) error {
	l, role, err := s.find(ctx, actor, listID)
	if err != nil {
		return err
	}
	if role != group.RoleOwner && role != group.RoleAdmin {
		return ErrForbidden
	}
	// Two deletes at once: the second finds no row and returns ErrNotFound
	// from the repository, so only the first one publishes.
	if err := s.repo.Delete(ctx, listID); err != nil {
		return fmt.Errorf("delete list: %w", err)
	}
	// The items go with the list without an event of their own: clients
	// drop them together with the list.
	s.pub.ListDeleted(ctx, actor, l)
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

// checkIcon returns fallback for an empty icon and ErrInvalidIcon for one
// that is not in the set.
func checkIcon(icon, fallback Icon) (Icon, error) {
	if icon == "" {
		return fallback, nil
	}
	if !icon.Valid() {
		return "", fmt.Errorf("%w: %q", ErrInvalidIcon, icon)
	}
	return icon, nil
}
