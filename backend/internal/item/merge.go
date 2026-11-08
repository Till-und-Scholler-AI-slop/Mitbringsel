package item

import (
	"errors"
	"fmt"
	"time"
)

// Field is a field of an item that has its own clock. Changes are merged per
// field (ADR 0004): two people changing different fields both keep their
// change, and only a change to the same field has a winner.
type Field string

const (
	FieldName     Field = "name"
	FieldQuantity Field = "quantity"
	FieldUnit     Field = "unit"
	FieldNote     Field = "note"
	// FieldChecked also covers who checked the item and when: checked_by and
	// checked_at only make sense together with checked, so they travel with
	// its clock.
	FieldChecked Field = "checked"
)

// Valid reports whether f is one of the fields above.
func (f Field) Valid() bool {
	switch f {
	case FieldName, FieldQuantity, FieldUnit, FieldNote, FieldChecked:
		return true
	}
	return false
}

// Clocks holds the clock of the latest accepted change per field. A field
// without an entry has never been changed since the item was created.
type Clocks map[Field]HLC

// MaxClockSkew is how far ahead of the server a device clock may be. A
// clock further in the future would win every conflict for a long time, so
// the server treats it as "now" (docs/sync.md).
const MaxClockSkew = 5 * time.Minute

var (
	// ErrUnknownField means a change names a field that has no clock.
	ErrUnknownField = errors.New("unknown item field")
)

// Merge decides which of the incoming changes win. current holds the clocks
// of the stored item, incoming the clock of each field the sender changed
// (all fields of one change usually carry the same clock). deleted says if
// the item is a tombstone, now is the server time.
//
// The result holds the fields that win, with the clock to store for each.
// For those the caller writes the new value; for all others the stored value
// stays. It is empty, not nil, if nothing wins, which is no error: an old
// change from an offline device is simply outdated.
//
// The rules:
//   - A change wins if its clock is greater than the stored one, or if the
//     field has no clock yet. Equal clocks do not win, the stored change
//     stays; the same change arriving twice is therefore harmless.
//   - A clock more than MaxClockSkew ahead of now is replaced by now. The
//     counter and the node stay, so changes of one device keep their order.
//   - A deleted item accepts nothing: deleting wins over every later edit,
//     even an offline edit made earlier but sent later.
//   - Invalid input (unknown field, invalid clock) fails the whole merge
//     before anything is decided.
func Merge(current, incoming Clocks, deleted bool, now time.Time) (Clocks, error) {
	// Check everything first, so an invalid request is refused whether or not
	// the item happens to be deleted.
	accepted := make(Clocks, len(incoming))
	for field, clock := range incoming {
		if !field.Valid() {
			return nil, fmt.Errorf("%w: %q", ErrUnknownField, field)
		}
		clock, err := limitSkew(clock, now)
		if err != nil {
			return nil, fmt.Errorf("field %q: %w", field, err)
		}
		accepted[field] = clock
	}

	won := Clocks{}
	if deleted {
		return won, nil
	}
	for field, clock := range accepted {
		// Comparing the strings is comparing the clocks (see HLC).
		if stored, ok := current[field]; !ok || clock > stored {
			won[field] = clock
		}
	}
	return won, nil
}

// limitSkew replaces a clock that is too far ahead of now by one at now.
func limitSkew(clock HLC, now time.Time) (HLC, error) {
	p, err := clock.parts()
	if err != nil {
		return "", err
	}
	if !time.UnixMilli(p.wallMs).After(now.Add(MaxClockSkew)) {
		return clock, nil
	}
	return NewHLC(now, p.counter, p.node)
}
