// Package list holds the shopping lists of a group ("Supermarkt", "Baumarkt").
// Items on a list follow in their own step.
package list

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"mitbringsel/internal/group"
)

// MaxNameLength is the longest list name in characters (not bytes). The
// database checks the same limit.
const MaxNameLength = 50

var (
	// ErrNotFound means the list does not exist or the user is not a member
	// of its group. Both look the same to the caller, so nobody can find
	// out which lists exist by trying IDs.
	ErrNotFound = errors.New("list not found")
	// ErrForbidden means the user is a member, but their role does not
	// allow this.
	ErrForbidden = errors.New("not allowed for this role")
	// ErrInvalidName means the name is empty or too long after trimming.
	ErrInvalidName = errors.New("invalid list name")
)

// List is a stored list.
type List struct {
	ID      uuid.UUID
	GroupID uuid.UUID
	Name    string
	// ArchivedAt is nil for an active list.
	ArchivedAt *time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
	// ServerSeq orders changes across lists and items (docs/data-model.md).
	ServerSeq int64
}

// Archived reports whether the list is hidden from the normal view.
func (l List) Archived() bool {
	return l.ArchivedAt != nil
}

// MemberLookup tells the service what role a user has in a group. It is
// defined here, at the consumer, and group.PostgresRepository satisfies it:
// the list service needs this one method, not the whole group repository.
// It returns group.ErrNotFound if the user is not a member.
type MemberLookup interface {
	MemberRole(ctx context.Context, groupID, userID uuid.UUID) (group.Role, error)
}

// Repository stores lists. The service has already checked who may do what;
// methods that look up one list return ErrNotFound if it does not exist.
type Repository interface {
	Create(ctx context.Context, groupID uuid.UUID, name string) (List, error)
	Get(ctx context.Context, listID uuid.UUID) (List, error)
	// ListForGroup returns the group's lists, oldest first. Archived lists
	// are only included if includeArchived is true.
	ListForGroup(ctx context.Context, groupID uuid.UUID, includeArchived bool) ([]List, error)
	Rename(ctx context.Context, listID uuid.UUID, name string) (List, error)
	// SetArchived archives or unarchives the list. Archiving an archived
	// list keeps its original ArchivedAt.
	SetArchived(ctx context.Context, listID uuid.UUID, archived bool) (List, error)
	// Delete removes the list together with its items.
	Delete(ctx context.Context, listID uuid.UUID) error
}
