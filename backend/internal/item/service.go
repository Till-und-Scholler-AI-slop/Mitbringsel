package item

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"tuolino/internal/list"
)

// ListAccess is the door to the lists: it returns a list, or the lists of a
// group, if the user may see them, and list.ErrNotFound otherwise (also for
// a user outside the group). *list.Service satisfies it. Items use it so the
// membership rules live in one place.
type ListAccess interface {
	Get(ctx context.Context, actor, listID uuid.UUID) (list.List, error)
	ListForGroup(ctx context.Context, actor, groupID uuid.UUID, includeArchived bool) ([]list.List, error)
}

// Publisher tells the members of a group about an item change once it is
// committed. It is best effort: it must not block and has no error to return,
// because the change is stored either way. ctx is the request's and may be
// cancelled at any moment, so an implementation must not depend on it staying
// alive (use context.WithoutCancel for work that outlives the request).
type Publisher interface {
	// ItemChanged gets the item as stored after a create or an update.
	ItemChanged(ctx context.Context, groupID, actor uuid.UUID, it Item)
	// ItemDeleted gets the tombstone: ID, ListID and the ServerSeq of the
	// deletion are what matters.
	ItemDeleted(ctx context.Context, groupID, actor uuid.UUID, it Item)
	// ItemsDeleted gets the tombstones of several items of one list that
	// were deleted at once; never an empty slice.
	ItemsDeleted(ctx context.Context, groupID, listID, actor uuid.UUID, tombstones []Item)
}

// noPublisher is the Publisher for callers without live connections (the
// seed command, tests). It does nothing.
type noPublisher struct{}

func (noPublisher) ItemChanged(context.Context, uuid.UUID, uuid.UUID, Item)               {}
func (noPublisher) ItemDeleted(context.Context, uuid.UUID, uuid.UUID, Item)               {}
func (noPublisher) ItemsDeleted(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, []Item) {}

// Service holds the rules for items. Every method takes the acting user
// (actor) and checks what they may do, so a handler cannot forget it.
//
// Every member may create, change, check and delete items, also in an
// archived list: an offline device may still have changes from before the
// list was archived (docs/sync.md).
//
// The methods take the clock of the change from the caller: the one of the
// device that made it, or one the server issued for a request without a
// clock (docs/sync.md).
type Service struct {
	repo  Repository
	lists ListAccess
	pub   Publisher
	// now is the server time; tests replace it.
	now func() time.Time
}

// NewService returns a service backed by the given repository. pub is told
// about every change after it is committed; nil means nobody listens.
func NewService(repo Repository, lists ListAccess, pub Publisher) *Service {
	if pub == nil {
		pub = noPublisher{}
	}
	return &Service{repo: repo, lists: lists, pub: pub, now: time.Now}
}

// Create adds an item to a list. If an item with this ID already exists in
// the same list, the request was sent twice (a lost answer, an offline
// retry), and the stored item is returned unchanged. If the ID belongs to an
// item elsewhere, it returns ErrIDTaken.
func (s *Service) Create(ctx context.Context, actor, listID uuid.UUID, n NewItem, clock HLC) (Item, error) {
	// Access first: an outsider must not learn anything about the rules.
	l, err := s.requireList(ctx, actor, listID)
	if err != nil {
		return Item{}, err
	}
	if n.ID == uuid.Nil {
		return Item{}, ErrInvalidID
	}
	name, quantity, unit, note, err := validateNew(n)
	if err != nil {
		return Item{}, err
	}

	// A new item stamps all its fields with the clock of its creation, so
	// an edit made before it existed cannot win. Merge also limits a clock
	// that runs too far ahead.
	stamps := Clocks{}
	for _, f := range []Field{FieldName, FieldQuantity, FieldUnit, FieldNote, FieldChecked, FieldList} {
		stamps[f] = clock
	}
	clocks, err := Merge(nil, stamps, false, s.now())
	if err != nil {
		return Item{}, fmt.Errorf("create item: %w", err)
	}

	created, err := s.repo.Create(ctx, Item{
		ID:        n.ID,
		ListID:    listID,
		Name:      name,
		Quantity:  quantity,
		Unit:      unit,
		Note:      note,
		CreatedBy: &actor,
		Clocks:    clocks,
	})
	if errors.Is(err, ErrIDTaken) {
		existing, getErr := s.repo.Get(ctx, n.ID)
		if getErr == nil && existing.ListID == listID {
			return existing, nil
		}
		return Item{}, ErrIDTaken
	}
	if err != nil {
		return Item{}, fmt.Errorf("create item: %w", err)
	}
	s.pub.ItemChanged(ctx, l.GroupID, actor, created)
	return created, nil
}

// ListForList returns the items of a list that are not deleted, oldest
// first.
func (s *Service) ListForList(ctx context.Context, actor, listID uuid.UUID) ([]Item, error) {
	if _, err := s.requireList(ctx, actor, listID); err != nil {
		return nil, err
	}
	items, err := s.repo.ListForList(ctx, listID)
	if err != nil {
		return nil, fmt.Errorf("list items: %w", err)
	}
	return items, nil
}

// ListForGroup returns the active lists of a group and their items that are
// not deleted, oldest first. Clients load them in one go to have them
// offline (ADR 0006). Archived lists are left out; their items load with
// ListForList when someone opens one.
//
// The answer covers exactly the lists in ListIDs, even those without items:
// the lists and their items are two reads without a common transaction, so
// a list archived in between stays in ListIDs and the client learns about
// the archiving from the event, not from this answer.
func (s *Service) ListForGroup(ctx context.Context, actor, groupID uuid.UUID) (GroupItems, error) {
	lists, err := s.lists.ListForGroup(ctx, actor, groupID, false)
	if errors.Is(err, list.ErrNotFound) {
		return GroupItems{}, ErrGroupNotFound
	}
	if err != nil {
		return GroupItems{}, fmt.Errorf("list lists: %w", err)
	}
	if len(lists) == 0 {
		return GroupItems{}, nil
	}
	ids := make([]uuid.UUID, len(lists))
	for i, l := range lists {
		ids[i] = l.ID
	}
	items, err := s.repo.ListForLists(ctx, ids)
	if err != nil {
		return GroupItems{}, fmt.Errorf("list items: %w", err)
	}
	return GroupItems{ListIDs: ids, Items: items}, nil
}

// DeleteOldTombstones removes the items deleted more than
// TombstoneRetention ago for good. The cleanup job calls it.
func (s *Service) DeleteOldTombstones(ctx context.Context) (int64, error) {
	deleted, err := s.repo.DeleteTombstones(ctx, s.now().Add(-TombstoneRetention))
	if err != nil {
		return 0, fmt.Errorf("delete item tombstones: %w", err)
	}
	return deleted, nil
}

// Get returns one item, also a deleted one (check Deleted).
func (s *Service) Get(ctx context.Context, actor, itemID uuid.UUID) (Item, error) {
	it, _, err := s.find(ctx, actor, itemID)
	return it, err
}

// Update applies a change to an item and returns the item as it is stored
// afterwards. The change is merged per field: a field only changes if the
// clock is newer than the one stored for it (see Merge). A field that loses
// keeps its value, the other fields of the same change still apply. If
// nothing wins, or the item is deleted, the stored item comes back
// unchanged; check Deleted.
func (s *Service) Update(ctx context.Context, actor, itemID uuid.UUID, change Change, clock HLC) (Item, error) {
	// Access first: an outsider must not learn anything about the rules.
	found, l, err := s.find(ctx, actor, itemID)
	if err != nil {
		return Item{}, err
	}
	change, err = validateChange(change)
	if err != nil {
		return Item{}, err
	}
	incoming := change.clocks(clock)
	if len(incoming) == 0 {
		return Item{}, ErrEmptyChange
	}

	var result Item
	// changed is set inside the transaction and read after it: only a
	// committed change is published.
	var changed bool
	// One transaction with the row locked: another change to this item
	// waits here until we are done, so it merges against our result.
	err = s.repo.InTx(ctx, func(tx Repository) error {
		current, err := tx.GetForUpdate(ctx, found.ID)
		if err != nil {
			return err
		}
		now := s.now()
		won, err := Merge(current.Clocks, incoming, current.Deleted(), now)
		if err != nil {
			return err
		}
		if len(won) == 0 {
			result = current
			return nil
		}
		changed = true

		update := Update{
			Change:    change.only(won),
			UpdatedBy: &actor,
			UpdatedAt: now,
			Clocks:    won,
		}
		if _, ok := won[FieldChecked]; ok && change.Checked.Value {
			update.CheckedBy = &actor
			update.CheckedAt = &now
		}
		result, err = tx.Apply(ctx, found.ID, update)
		return err
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrInvalidHLC) || errors.Is(err, ErrUnknownField) {
			return Item{}, err
		}
		return Item{}, fmt.Errorf("update item: %w", err)
	}
	// After the commit, so a listener who reads the database finds the change.
	// Nothing is published if no field won: nothing was stored.
	if changed {
		s.pub.ItemChanged(ctx, l.GroupID, actor, result)
	}
	return result, nil
}

// Delete turns an item into a tombstone. Deleting always wins over edits,
// and deleting twice is harmless. It returns the stored item.
func (s *Service) Delete(ctx context.Context, actor, itemID uuid.UUID) (Item, error) {
	found, l, err := s.find(ctx, actor, itemID)
	if err != nil {
		return Item{}, err
	}
	deleted, err := s.repo.MarkDeleted(ctx, found.ID)
	if err != nil {
		return Item{}, fmt.Errorf("delete item: %w", err)
	}
	// found is the state before the deletion: only the first delete changed
	// something. Two deletes at the same moment may both see a live item and
	// publish twice with the same serverSeq; clients drop the second one.
	if !found.Deleted() {
		s.pub.ItemDeleted(ctx, l.GroupID, actor, deleted)
	}
	return deleted, nil
}

// RemoveChecked deletes the given items of a list at once ("remove checked
// items"). The client names the items it showed as checked, so an item that
// someone checked while the request was on its way stays. Only items that
// are still checked are deleted: one unchecked meanwhile is needed again.
// IDs of other lists, unknown or deleted items are skipped. It returns the
// new tombstones, in no particular order; none if nothing was deleted.
func (s *Service) RemoveChecked(ctx context.Context, actor, listID uuid.UUID, itemIDs []uuid.UUID) ([]Item, error) {
	// Access first: an outsider must not learn anything about the rules.
	l, err := s.requireList(ctx, actor, listID)
	if err != nil {
		return nil, err
	}
	if len(itemIDs) > MaxRemoveItems {
		return nil, fmt.Errorf("%w: more than %d", ErrTooManyItems, MaxRemoveItems)
	}

	deleted, err := s.repo.MarkCheckedDeleted(ctx, listID, itemIDs)
	if err != nil {
		return nil, fmt.Errorf("remove checked items: %w", err)
	}
	// One event for all of them, and none if nothing changed.
	if len(deleted) > 0 {
		s.pub.ItemsDeleted(ctx, l.GroupID, listID, actor, deleted)
	}
	return deleted, nil
}

// find loads an item and checks that the actor may see its list. It returns
// the item together with its list. It returns ErrNotFound if the item does
// not exist or the actor is not a member.
func (s *Service) find(ctx context.Context, actor, itemID uuid.UUID) (Item, list.List, error) {
	it, err := s.repo.Get(ctx, itemID)
	if errors.Is(err, ErrNotFound) {
		return Item{}, list.List{}, ErrNotFound
	}
	if err != nil {
		return Item{}, list.List{}, fmt.Errorf("get item: %w", err)
	}
	l, err := s.requireList(ctx, actor, it.ListID)
	if err != nil {
		return Item{}, list.List{}, err
	}
	return it, l, nil
}

// requireList returns the list if the actor may see it, and ErrNotFound
// otherwise.
func (s *Service) requireList(ctx context.Context, actor, listID uuid.UUID) (list.List, error) {
	l, err := s.lists.Get(ctx, actor, listID)
	if errors.Is(err, list.ErrNotFound) {
		return list.List{}, ErrNotFound
	}
	if err != nil {
		return list.List{}, fmt.Errorf("get list: %w", err)
	}
	return l, nil
}

// validateNew checks and cleans the fields of a new item.
func validateNew(n NewItem) (name string, quantity *float64, unit *Unit, note *string, err error) {
	if name, err = normalizeName(n.Name); err != nil {
		return "", nil, nil, nil, err
	}
	if quantity, err = checkQuantity(n.Quantity); err != nil {
		return "", nil, nil, nil, err
	}
	if unit, err = checkUnit(n.Unit); err != nil {
		return "", nil, nil, nil, err
	}
	if note, err = normalizeNote(n.Note); err != nil {
		return "", nil, nil, nil, err
	}
	return name, quantity, unit, note, nil
}

// validateChange checks and cleans the fields a change sets.
func validateChange(c Change) (Change, error) {
	var err error
	if c.Name.Set {
		if c.Name.Value, err = normalizeName(c.Name.Value); err != nil {
			return Change{}, err
		}
	}
	if c.Quantity.Set {
		if c.Quantity.Value, err = checkQuantity(c.Quantity.Value); err != nil {
			return Change{}, err
		}
	}
	if c.Unit.Set {
		if c.Unit.Value, err = checkUnit(c.Unit.Value); err != nil {
			return Change{}, err
		}
	}
	if c.Note.Set {
		if c.Note.Value, err = normalizeNote(c.Note.Value); err != nil {
			return Change{}, err
		}
	}
	return c, nil
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

// checkQuantity accepts nil (no quantity) or a finite number above 0.
func checkQuantity(q *float64) (*float64, error) {
	if q == nil {
		return nil, nil
	}
	if math.IsNaN(*q) || math.IsInf(*q, 0) || *q <= 0 || *q > MaxQuantity {
		return nil, fmt.Errorf("%w: must be above 0 and at most %d", ErrInvalidQuantity, MaxQuantity)
	}
	v := *q
	return &v, nil
}

// checkUnit accepts nil (no unit) or a unit from the fixed set.
func checkUnit(u *Unit) (*Unit, error) {
	if u == nil {
		return nil, nil
	}
	if !u.Valid() {
		return nil, fmt.Errorf("%w: %q", ErrInvalidUnit, *u)
	}
	v := *u
	return &v, nil
}

// normalizeNote trims the note. An empty note is the same as none.
func normalizeNote(note *string) (*string, error) {
	if note == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*note)
	if trimmed == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(trimmed) > MaxNoteLength {
		return nil, fmt.Errorf("%w: note is longer than %d characters", ErrInvalidNote, MaxNoteLength)
	}
	return &trimmed, nil
}
