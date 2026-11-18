package item

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

const (
	// MaxNameLength and MaxNoteLength are in characters, not bytes. The
	// database checks the same limits.
	MaxNameLength = 100
	MaxNoteLength = 500
	// MaxQuantity is a sanity limit: nobody buys more than this of anything.
	MaxQuantity = 100_000
	// MaxRemoveItems is how many items one RemoveChecked may name. It keeps
	// the request and the statement small; no shopping trip checks more.
	MaxRemoveItems = 500
	// TombstoneRetention is how long a deleted item is kept as a tombstone,
	// so a late offline edit still finds it and loses ("delete wins"). The
	// outbox of the client drops changes older than this (ADR 0006).
	TombstoneRetention = 30 * 24 * time.Hour
)

var (
	// ErrNotFound means the item does not exist or the user is not a member
	// of its group. Both look the same to the caller.
	ErrNotFound = errors.New("item not found")
	// ErrIDTaken means the ID the client chose belongs to an item in
	// another list. The same ID in the same list is a repeated request and
	// no error.
	ErrIDTaken = errors.New("item id already used elsewhere")
	// ErrGroupNotFound means the group does not exist or the user is not a
	// member of it.
	ErrGroupNotFound = errors.New("group not found")
	// ErrInvalidID means the ID is the zero UUID.
	ErrInvalidID = errors.New("invalid item id")
	// ErrInvalidName means the name is empty or too long after trimming.
	ErrInvalidName = errors.New("invalid item name")
	// ErrInvalidQuantity means the quantity is not a number between 0
	// (exclusive) and MaxQuantity.
	ErrInvalidQuantity = errors.New("invalid quantity")
	// ErrInvalidUnit means the unit is not one of the fixed set.
	ErrInvalidUnit = errors.New("invalid unit")
	// ErrInvalidNote means the note is too long.
	ErrInvalidNote = errors.New("invalid note")
	// ErrEmptyChange means an update names no field at all.
	ErrEmptyChange = errors.New("change contains no field")
	// ErrTooManyItems means a RemoveChecked names more than MaxRemoveItems
	// items.
	ErrTooManyItems = errors.New("too many items")
)

// Unit is how a quantity is measured. The set is fixed (docs/data-model.md);
// the UI translates the names.
type Unit string

const (
	UnitPiece      Unit = "piece"
	UnitGram       Unit = "g"
	UnitKilogram   Unit = "kg"
	UnitMilliliter Unit = "ml"
	UnitLiter      Unit = "l"
	UnitPack       Unit = "pack"
)

// Valid reports whether u is one of the units above.
func (u Unit) Valid() bool {
	switch u {
	case UnitPiece, UnitGram, UnitKilogram, UnitMilliliter, UnitLiter, UnitPack:
		return true
	}
	return false
}

// Item is a stored item.
type Item struct {
	ID     uuid.UUID
	ListID uuid.UUID
	Name   string
	// Quantity, Unit and Note are nil if not set.
	Quantity *float64
	Unit     *Unit
	Note     *string
	Checked  bool
	// CheckedBy and CheckedAt are only set while the item is checked; the
	// person is nil if they deleted their account.
	CheckedBy *uuid.UUID
	CheckedAt *time.Time
	// CreatedBy is nil if the person deleted their account.
	CreatedBy *uuid.UUID
	CreatedAt time.Time
	// DeletedAt is set for a tombstone: the item is gone for the users, but
	// stays so that offline devices learn about the deletion.
	DeletedAt *time.Time
	// Clocks holds the clock of the latest accepted change per field.
	Clocks Clocks
	// ServerSeq orders changes across lists and items (docs/data-model.md).
	ServerSeq int64
}

// Deleted reports whether the item is a tombstone.
func (i Item) Deleted() bool {
	return i.DeletedAt != nil
}

// GroupItems is the answer to "all items of a group": the active lists it
// covers and their items that are not deleted.
type GroupItems struct {
	// ListIDs names every active list of the group the answer covers, also
	// the ones without items. Without it a client could not tell an empty
	// list from one the answer does not know about.
	ListIDs []uuid.UUID
	Items   []Item
}

// NewItem is what a client sends to create an item.
type NewItem struct {
	// ID is chosen by the client (a UUIDv7), so it can create items offline.
	ID       uuid.UUID
	Name     string
	Quantity *float64
	Unit     *Unit
	Note     *string
}

// Optional is a value in a change that may be left out. The zero value means
// "leave as it is". For a field that can be empty, T is a pointer, and Some(nil)
// means "clear it": Optional[*float64] tells apart "keep the quantity",
// "set it to 2" and "remove it".
type Optional[T any] struct {
	Set   bool
	Value T
}

// Some returns an Optional that carries v.
func Some[T any](v T) Optional[T] {
	return Optional[T]{Set: true, Value: v}
}

// Change is an edit of an item. Only the fields that are set are changed.
type Change struct {
	Name     Optional[string]
	Quantity Optional[*float64]
	Unit     Optional[*Unit]
	Note     Optional[*string]
	Checked  Optional[bool]
}

// clocks returns the clock for every field the change sets.
func (c Change) clocks(clock HLC) Clocks {
	out := Clocks{}
	if c.Name.Set {
		out[FieldName] = clock
	}
	if c.Quantity.Set {
		out[FieldQuantity] = clock
	}
	if c.Unit.Set {
		out[FieldUnit] = clock
	}
	if c.Note.Set {
		out[FieldNote] = clock
	}
	if c.Checked.Set {
		out[FieldChecked] = clock
	}
	return out
}

// only returns the change reduced to the fields in won.
func (c Change) only(won Clocks) Change {
	var out Change
	if _, ok := won[FieldName]; ok {
		out.Name = c.Name
	}
	if _, ok := won[FieldQuantity]; ok {
		out.Quantity = c.Quantity
	}
	if _, ok := won[FieldUnit]; ok {
		out.Unit = c.Unit
	}
	if _, ok := won[FieldNote]; ok {
		out.Note = c.Note
	}
	if _, ok := won[FieldChecked]; ok {
		out.Checked = c.Checked
	}
	return out
}

// Update is what the service tells the repository to write: the fields that
// won the merge, who checked the item and when, and the clocks to store.
type Update struct {
	Change
	// CheckedBy and CheckedAt belong to Checked: both are set when the item
	// gets checked and nil when it gets unchecked.
	CheckedBy *uuid.UUID
	CheckedAt *time.Time
	Clocks    Clocks
}

// Repository stores items. The service has already checked who may do what;
// methods that look up one item return ErrNotFound if it does not exist.
type Repository interface {
	// InTx runs fn with a repository whose methods all share one database
	// transaction. If fn returns an error, nothing fn did is stored.
	InTx(ctx context.Context, fn func(tx Repository) error) error

	// Create stores a new item. It returns ErrIDTaken if the ID exists.
	Create(ctx context.Context, item Item) (Item, error)
	Get(ctx context.Context, itemID uuid.UUID) (Item, error)
	// GetForUpdate is Get, and blocks other transactions that lock the same
	// item until this one ends. Only meaningful inside InTx.
	GetForUpdate(ctx context.Context, itemID uuid.UUID) (Item, error)
	// ListForList returns the items of a list that are not deleted, oldest
	// first.
	ListForList(ctx context.Context, listID uuid.UUID) ([]Item, error)
	// ListForLists does the same for several lists at once.
	ListForLists(ctx context.Context, listIDs []uuid.UUID) ([]Item, error)
	// Apply writes the update and draws a new server_seq.
	Apply(ctx context.Context, itemID uuid.UUID, update Update) (Item, error)
	// MarkDeleted turns the item into a tombstone. For a tombstone already,
	// it changes nothing.
	MarkDeleted(ctx context.Context, itemID uuid.UUID) (Item, error)
	// MarkCheckedDeleted turns those of the given items into tombstones that
	// belong to the list, are checked and not deleted yet, all at once. It
	// returns the new tombstones in no particular order; IDs it skips are
	// not an error.
	MarkCheckedDeleted(ctx context.Context, listID uuid.UUID, itemIDs []uuid.UUID) ([]Item, error)
	// DeleteTombstones removes the items deleted before cutoff for good and
	// returns how many.
	DeleteTombstones(ctx context.Context, cutoff time.Time) (int64, error)
}
