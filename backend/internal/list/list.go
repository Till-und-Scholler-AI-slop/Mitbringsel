// Package list holds the shopping lists of a group ("Supermarkt", "Baumarkt").
// Items on a list follow in their own step.
package list

import (
	"context"
	"errors"
	"slices"
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
	// ErrInvalidIcon means the icon is not one of the fixed set.
	ErrInvalidIcon = errors.New("invalid list icon")
)

// Icon is the sticker shown next to the list's name. The set is fixed (the
// database checks it, too); the frontend draws each one.
type Icon string

// The icons, grouped like the picker in the design: food, household and
// care, everything else.
const (
	IconSupermarket Icon = "supermarket"
	IconMarket      Icon = "market"
	IconBakery      Icon = "bakery"
	IconButcher     Icon = "butcher"
	IconDrinks      Icon = "drinks"
	IconOrganic     Icon = "organic"

	IconDrugstore Icon = "drugstore"
	IconPharmacy  Icon = "pharmacy"
	IconBaby      Icon = "baby"
	IconPets      Icon = "pets"
	IconHardware  Icon = "hardware"
	IconGarden    Icon = "garden"

	IconFurniture   Icon = "furniture"
	IconElectronics Icon = "electronics"
	IconStationery  Icon = "stationery"
	IconClothing    Icon = "clothing"
	IconOnline      Icon = "online"
	IconGeneral     Icon = "general"
)

// DefaultIcon is what a list gets if nobody picks one.
const DefaultIcon = IconGeneral

// Icons lists every valid icon in the order above.
var Icons = []Icon{
	IconSupermarket, IconMarket, IconBakery, IconButcher, IconDrinks, IconOrganic,
	IconDrugstore, IconPharmacy, IconBaby, IconPets, IconHardware, IconGarden,
	IconFurniture, IconElectronics, IconStationery, IconClothing, IconOnline, IconGeneral,
}

// Valid reports whether i is one of the icons above.
func (i Icon) Valid() bool {
	return slices.Contains(Icons, i)
}

// List is a stored list.
type List struct {
	ID      uuid.UUID
	GroupID uuid.UUID
	Name    string
	Icon    Icon
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
	Create(ctx context.Context, groupID uuid.UUID, name string, icon Icon) (List, error)
	Get(ctx context.Context, listID uuid.UUID) (List, error)
	// ListForGroup returns the group's lists, oldest first. Archived lists
	// are only included if includeArchived is true.
	ListForGroup(ctx context.Context, groupID uuid.UUID, includeArchived bool) ([]List, error)
	// Update sets name and icon; the service passes the current value for
	// whatever does not change.
	Update(ctx context.Context, listID uuid.UUID, name string, icon Icon) (List, error)
	// SetArchived archives or unarchives the list. Archiving an archived
	// list keeps its original ArchivedAt.
	SetArchived(ctx context.Context, listID uuid.UUID, archived bool) (List, error)
	// Delete removes the list together with its items.
	Delete(ctx context.Context, listID uuid.UUID) error
}
