// Package group holds the group domain: groups ("households" in the UI) and
// their members with roles. Invites follow in their own step.
package group

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Role is what a member may do in a group.
type Role string

const (
	// RoleOwner manages the group: rename, delete, members and roles.
	RoleOwner Role = "owner"
	// RoleMember uses the group's lists.
	RoleMember Role = "member"
)

func (r Role) valid() bool {
	return r == RoleOwner || r == RoleMember
}

// MaxNameLength is the longest group name in characters (not bytes, so
// "Kaiserstraße" counts 12). The database checks the same limit.
const MaxNameLength = 100

var (
	// ErrNotFound means the group does not exist or the user is not a
	// member. Both look the same to the caller, so nobody can find out
	// which groups exist by trying IDs (docs/auth.md).
	ErrNotFound = errors.New("group not found")
	// ErrForbidden means the user is a member but needs to be an owner.
	ErrForbidden = errors.New("only owners may do this")
	// ErrInvalidName means the name is empty or too long after trimming.
	ErrInvalidName = errors.New("invalid group name")
	// ErrInvalidRole means a role other than owner or member was requested.
	ErrInvalidRole = errors.New("invalid role")
	// ErrLastOwner means the change would leave the group without an
	// owner. Someone else must become owner first, or the group is deleted.
	ErrLastOwner = errors.New("a group needs at least one owner")
)

// Group is a stored group.
type Group struct {
	ID        uuid.UUID
	Name      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Member is a user in a group, with the profile data the UI shows.
type Member struct {
	UserID      uuid.UUID
	DisplayName string
	// AvatarURL is empty if the user has no avatar.
	AvatarURL string
	Role      Role
	JoinedAt  time.Time
}

// Membership is a group together with one user's role in it.
type Membership struct {
	Group Group
	Role  Role
}

// Details is a group as one of its members sees it: Role is that member's
// own role, Members lists everyone including them.
type Details struct {
	Group
	Role    Role
	Members []Member
}

// Repository stores groups and memberships. Like user.Repository it lives
// here, at the consumer, so the service can be tested with a fake. Methods
// that look up one group or member return ErrNotFound if it does not exist.
type Repository interface {
	// InTx runs fn with a repository whose methods all share one database
	// transaction. If fn returns an error, nothing fn did is stored.
	InTx(ctx context.Context, fn func(tx Repository) error) error

	// Lock blocks other transactions that lock the same group until this
	// one ends. Only meaningful inside InTx.
	Lock(ctx context.Context, groupID uuid.UUID) error

	Create(ctx context.Context, name string, createdBy uuid.UUID) (Group, error)
	Get(ctx context.Context, groupID uuid.UUID) (Group, error)
	Rename(ctx context.Context, groupID uuid.UUID, name string) (Group, error)
	Delete(ctx context.Context, groupID uuid.UUID) error

	// ListForUser returns the groups the user is a member of.
	ListForUser(ctx context.Context, userID uuid.UUID) ([]Membership, error)
	// Members returns the members of the given groups, keyed by group ID.
	Members(ctx context.Context, groupIDs []uuid.UUID) (map[uuid.UUID][]Member, error)
	MemberRole(ctx context.Context, groupID, userID uuid.UUID) (Role, error)
	CountOwners(ctx context.Context, groupID uuid.UUID) (int, error)

	AddMember(ctx context.Context, groupID, userID uuid.UUID, role Role) error
	RemoveMember(ctx context.Context, groupID, userID uuid.UUID) error
	SetRole(ctx context.Context, groupID, userID uuid.UUID, role Role) error
}
