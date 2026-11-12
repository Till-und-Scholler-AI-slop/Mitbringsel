package item

import (
	"context"
	"errors"
	"math"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"mitbringsel/internal/list"
)

var errRepo = errors.New("repository failure")

// fakeRepo keeps items in a map and applies updates like the SQL does.
type fakeRepo struct {
	items map[uuid.UUID]Item
	// fail makes every method return errRepo.
	fail bool
	// failCommit makes InTx return errRepo after fn has run, like a commit
	// that fails.
	failCommit bool
	seq        int64
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{items: map[uuid.UUID]Item{}}
}

func (r *fakeRepo) InTx(_ context.Context, fn func(tx Repository) error) error {
	if r.fail {
		return errRepo
	}
	if err := fn(r); err != nil {
		return err
	}
	if r.failCommit {
		return errRepo
	}
	return nil
}

func (r *fakeRepo) Create(_ context.Context, it Item) (Item, error) {
	if r.fail {
		return Item{}, errRepo
	}
	if _, exists := r.items[it.ID]; exists {
		return Item{}, ErrIDTaken
	}
	it.CreatedAt = at
	r.seq++
	it.ServerSeq = r.seq
	r.items[it.ID] = it
	return it, nil
}

func (r *fakeRepo) Get(_ context.Context, itemID uuid.UUID) (Item, error) {
	if r.fail {
		return Item{}, errRepo
	}
	it, ok := r.items[itemID]
	if !ok {
		return Item{}, ErrNotFound
	}
	return it, nil
}

func (r *fakeRepo) GetForUpdate(ctx context.Context, itemID uuid.UUID) (Item, error) {
	return r.Get(ctx, itemID)
}

func (r *fakeRepo) ListForList(_ context.Context, listID uuid.UUID) ([]Item, error) {
	if r.fail {
		return nil, errRepo
	}
	var out []Item
	for _, it := range r.items {
		if it.ListID == listID && !it.Deleted() {
			out = append(out, it)
		}
	}
	return out, nil
}

func (r *fakeRepo) Apply(_ context.Context, itemID uuid.UUID, u Update) (Item, error) {
	it, err := r.Get(context.Background(), itemID)
	if err != nil {
		return Item{}, err
	}
	if u.Name.Set {
		it.Name = u.Name.Value
	}
	if u.Quantity.Set {
		it.Quantity = u.Quantity.Value
	}
	if u.Unit.Set {
		it.Unit = u.Unit.Value
	}
	if u.Note.Set {
		it.Note = u.Note.Value
	}
	if u.Checked.Set {
		it.Checked, it.CheckedBy, it.CheckedAt = u.Checked.Value, u.CheckedBy, u.CheckedAt
	}
	merged := Clocks{}
	for f, c := range it.Clocks {
		merged[f] = c
	}
	for f, c := range u.Clocks {
		merged[f] = c
	}
	it.Clocks = merged
	r.seq++
	it.ServerSeq = r.seq
	r.items[itemID] = it
	return it, nil
}

func (r *fakeRepo) MarkDeleted(ctx context.Context, itemID uuid.UUID) (Item, error) {
	it, err := r.Get(ctx, itemID)
	if err != nil {
		return Item{}, err
	}
	if !it.Deleted() {
		deletedAt := at
		it.DeletedAt = &deletedAt
		r.seq++
		it.ServerSeq = r.seq
		r.items[itemID] = it
	}
	return it, nil
}

func (r *fakeRepo) MarkCheckedDeleted(_ context.Context, listID uuid.UUID, itemIDs []uuid.UUID) ([]Item, error) {
	if r.fail {
		return nil, errRepo
	}
	var out []Item
	for _, id := range itemIDs {
		it, ok := r.items[id]
		if !ok || it.ListID != listID || !it.Checked || it.Deleted() {
			continue
		}
		deletedAt := at
		it.DeletedAt = &deletedAt
		r.seq++
		it.ServerSeq = r.seq
		r.items[id] = it
		out = append(out, it)
	}
	return out, nil
}

// fakeGroupID is the group every fake list belongs to.
var fakeGroupID = uuid.MustParse("0190a8c4-0000-7000-8000-0000000000a1")

// publishedEvent is one call to the publisher.
type publishedEvent struct {
	kind    string // "changed" or "deleted"
	groupID uuid.UUID
	actor   uuid.UUID
	item    Item
}

// publishedBatch is one call to ItemsDeleted.
type publishedBatch struct {
	groupID    uuid.UUID
	listID     uuid.UUID
	actor      uuid.UUID
	tombstones []Item
}

// fakePublisher records what the service publishes.
type fakePublisher struct {
	events  []publishedEvent
	batches []publishedBatch
}

func (p *fakePublisher) ItemChanged(_ context.Context, groupID, actor uuid.UUID, it Item) {
	p.events = append(p.events, publishedEvent{"changed", groupID, actor, it})
}

func (p *fakePublisher) ItemDeleted(_ context.Context, groupID, actor uuid.UUID, it Item) {
	p.events = append(p.events, publishedEvent{"deleted", groupID, actor, it})
}

func (p *fakePublisher) ItemsDeleted(_ context.Context, groupID, listID, actor uuid.UUID, tombstones []Item) {
	p.batches = append(p.batches, publishedBatch{groupID, listID, actor, tombstones})
}

// fakeLists says which users may see which lists.
type fakeLists map[uuid.UUID]map[uuid.UUID]bool

func (l fakeLists) Get(_ context.Context, actor, listID uuid.UUID) (list.List, error) {
	if !l[listID][actor] {
		return list.List{}, list.ErrNotFound
	}
	return list.List{ID: listID, GroupID: fakeGroupID}, nil
}

// serverNow is the time of the server in the tests: an hour after the
// clocks the tests start with, so clocks a few minutes apart are not limited
// as "too far ahead".
var serverNow = at.Add(time.Hour)

type fixture struct {
	svc      *Service
	repo     *fakeRepo
	pub      *fakePublisher
	listID   uuid.UUID
	otherID  uuid.UUID // a list the member cannot see
	member   uuid.UUID
	outsider uuid.UUID
}

func newFixture() fixture {
	f := fixture{
		repo:     newFakeRepo(),
		pub:      &fakePublisher{},
		listID:   uuid.New(),
		otherID:  uuid.New(),
		member:   uuid.New(),
		outsider: uuid.New(),
	}
	lists := fakeLists{
		f.listID:  {f.member: true},
		f.otherID: {f.outsider: true},
	}
	f.svc = NewService(f.repo, lists, f.pub)
	f.svc.now = func() time.Time { return serverNow }
	return f
}

func (f fixture) clock(t *testing.T, minutes int, node string) HLC {
	t.Helper()
	return mustHLC(t, at.Add(time.Duration(minutes)*time.Minute), 0, node)
}

// create stores an item "Milch" with quantity 1 at minute 0 through the
// service.
func (f fixture) create(t *testing.T) Item {
	t.Helper()
	it, err := f.svc.Create(context.Background(), f.member, f.listID,
		NewItem{ID: uuid.New(), Name: "Milch", Quantity: ptr(1.0)}, f.clock(t, 0, "anna"))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	return it
}

func ptr[T any](v T) *T { return &v }

func TestService_Create(t *testing.T) {
	ctx := context.Background()

	t.Run("stores the item and stamps every field with the clock", func(t *testing.T) {
		f := newFixture()
		clock := f.clock(t, 0, "anna")
		id := uuid.New()

		it, err := f.svc.Create(ctx, f.member, f.listID, NewItem{
			ID: id, Name: "  Mehl ", Quantity: ptr(0.5), Unit: ptr(UnitKilogram), Note: ptr(" Typ 405 "),
		}, clock)

		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if it.ID != id || it.ListID != f.listID || it.Name != "Mehl" || *it.Quantity != 0.5 ||
			*it.Unit != UnitKilogram || *it.Note != "Typ 405" || it.Checked || it.Deleted() {
			t.Errorf("Create() = %+v", it)
		}
		if it.CreatedBy == nil || *it.CreatedBy != f.member {
			t.Errorf("CreatedBy = %v, want the member", it.CreatedBy)
		}
		for _, field := range []Field{FieldName, FieldQuantity, FieldUnit, FieldNote, FieldChecked} {
			if it.Clocks[field] != clock {
				t.Errorf("clock of %s = %q, want %q", field, it.Clocks[field], clock)
			}
		}
	})

	t.Run("a blank note is no note", func(t *testing.T) {
		f := newFixture()
		it, err := f.svc.Create(ctx, f.member, f.listID, NewItem{ID: uuid.New(), Name: "Mehl", Note: ptr("   ")}, f.clock(t, 0, "anna"))
		if err != nil || it.Note != nil {
			t.Errorf("Create() = %+v, %v, want no note", it, err)
		}
	})

	t.Run("a clock far in the future is set to now", func(t *testing.T) {
		f := newFixture()
		wrong := mustHLC(t, at.AddDate(1, 0, 0), 7, "anna")
		it, err := f.svc.Create(ctx, f.member, f.listID, NewItem{ID: uuid.New(), Name: "Mehl"}, wrong)
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if want := mustHLC(t, serverNow, 7, "anna"); it.Clocks[FieldName] != want {
			t.Errorf("clock = %q, want %q", it.Clocks[FieldName], want)
		}
	})

	t.Run("outsider and unknown list are not found", func(t *testing.T) {
		f := newFixture()
		for name, tc := range map[string]struct{ actor, list uuid.UUID }{
			"outsider":     {f.outsider, f.listID},
			"unknown list": {f.member, uuid.New()},
		} {
			_, err := f.svc.Create(ctx, tc.actor, tc.list, NewItem{ID: uuid.New(), Name: "Mehl"}, f.clock(t, 0, "a"))
			if !errors.Is(err, ErrNotFound) {
				t.Errorf("%s: error = %v, want %v", name, err, ErrNotFound)
			}
		}
		if len(f.repo.items) != 0 {
			t.Errorf("stored %d items, want none", len(f.repo.items))
		}
	})

	t.Run("outsider learns nothing about the rules", func(t *testing.T) {
		f := newFixture()
		_, err := f.svc.Create(ctx, f.outsider, f.listID, NewItem{ID: uuid.Nil, Name: ""}, "nonsense")
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("invalid input", func(t *testing.T) {
		tests := []struct {
			name    string
			item    NewItem
			clock   HLC
			wantErr error
		}{
			{"zero id", NewItem{ID: uuid.Nil, Name: "Mehl"}, "", ErrInvalidID},
			{"empty name", NewItem{ID: uuid.New(), Name: " "}, "", ErrInvalidName},
			{"name at the limit", NewItem{ID: uuid.New(), Name: strings.Repeat("ä", MaxNameLength)}, "", nil},
			{"name over the limit", NewItem{ID: uuid.New(), Name: strings.Repeat("ä", MaxNameLength+1)}, "", ErrInvalidName},
			{"quantity zero", NewItem{ID: uuid.New(), Name: "a", Quantity: ptr(0.0)}, "", ErrInvalidQuantity},
			{"quantity negative", NewItem{ID: uuid.New(), Name: "a", Quantity: ptr(-1.0)}, "", ErrInvalidQuantity},
			{"quantity NaN", NewItem{ID: uuid.New(), Name: "a", Quantity: ptr(math.NaN())}, "", ErrInvalidQuantity},
			{"quantity infinite", NewItem{ID: uuid.New(), Name: "a", Quantity: ptr(math.Inf(1))}, "", ErrInvalidQuantity},
			{"quantity at the limit", NewItem{ID: uuid.New(), Name: "a", Quantity: ptr(float64(MaxQuantity))}, "", nil},
			{"quantity over the limit", NewItem{ID: uuid.New(), Name: "a", Quantity: ptr(float64(MaxQuantity) + 1)}, "", ErrInvalidQuantity},
			{"unknown unit", NewItem{ID: uuid.New(), Name: "a", Unit: ptr(Unit("cup"))}, "", ErrInvalidUnit},
			{"note over the limit", NewItem{ID: uuid.New(), Name: "a", Note: ptr(strings.Repeat("a", MaxNoteLength+1))}, "", ErrInvalidNote},
			{"invalid clock", NewItem{ID: uuid.New(), Name: "a"}, "nonsense", ErrInvalidHLC},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				f := newFixture()
				clock := tt.clock
				if clock == "" {
					clock = f.clock(t, 0, "anna")
				}
				_, err := f.svc.Create(ctx, f.member, f.listID, tt.item, clock)
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("error = %v, want %v", err, tt.wantErr)
				}
			})
		}
	})

	t.Run("the same ID in the same list is a repeated request", func(t *testing.T) {
		f := newFixture()
		first := f.create(t)

		// The retry carries other values: the stored item must win.
		again, err := f.svc.Create(ctx, f.member, f.listID, NewItem{ID: first.ID, Name: "Etwas anderes"}, f.clock(t, 5, "anna"))

		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if again.Name != "Milch" || again.ServerSeq != first.ServerSeq || len(f.repo.items) != 1 {
			t.Errorf("Create() again = %+v, want the stored item, %d items", again, len(f.repo.items))
		}
	})

	t.Run("an ID from another list is taken", func(t *testing.T) {
		f := newFixture()
		foreign := Item{ID: uuid.New(), ListID: f.otherID, Name: "Fremd"}
		f.repo.items[foreign.ID] = foreign

		_, err := f.svc.Create(ctx, f.member, f.listID, NewItem{ID: foreign.ID, Name: "Mehl"}, f.clock(t, 0, "anna"))

		if !errors.Is(err, ErrIDTaken) {
			t.Errorf("error = %v, want %v", err, ErrIDTaken)
		}
		if f.repo.items[foreign.ID].Name != "Fremd" {
			t.Error("the foreign item was changed")
		}
	})

	t.Run("publishes the new item once with group and actor", func(t *testing.T) {
		f := newFixture()

		it := f.create(t)

		want := []publishedEvent{{"changed", fakeGroupID, f.member, it}}
		if !reflect.DeepEqual(f.pub.events, want) {
			t.Errorf("published %+v, want %+v", f.pub.events, want)
		}
	})

	t.Run("a repeated request publishes nothing", func(t *testing.T) {
		f := newFixture()
		first := f.create(t)
		f.pub.events = nil

		_, err := f.svc.Create(ctx, f.member, f.listID, NewItem{ID: first.ID, Name: "Milch"}, f.clock(t, 5, "anna"))

		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		if len(f.pub.events) != 0 {
			t.Errorf("published %+v, want nothing", f.pub.events)
		}
	})

	t.Run("errors publish nothing", func(t *testing.T) {
		foreign := Item{ID: uuid.New(), ListID: uuid.New(), Name: "Fremd"}
		tests := []struct {
			name    string
			actor   func(f fixture) uuid.UUID
			item    NewItem
			setup   func(f fixture)
			wantErr error
		}{
			{"outsider", func(f fixture) uuid.UUID { return f.outsider }, NewItem{ID: uuid.New(), Name: "Mehl"}, nil, ErrNotFound},
			{"invalid input", nil, NewItem{ID: uuid.New(), Name: " "}, nil, ErrInvalidName},
			{"id of another list", nil, NewItem{ID: foreign.ID, Name: "Mehl"}, func(f fixture) { f.repo.items[foreign.ID] = foreign }, ErrIDTaken},
			{"repository failure", nil, NewItem{ID: uuid.New(), Name: "Mehl"}, func(f fixture) { f.repo.fail = true }, errRepo},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				f := newFixture()
				if tt.setup != nil {
					tt.setup(f)
				}
				actor := f.member
				if tt.actor != nil {
					actor = tt.actor(f)
				}

				_, err := f.svc.Create(ctx, actor, f.listID, tt.item, f.clock(t, 0, "anna"))

				if !errors.Is(err, tt.wantErr) {
					t.Errorf("error = %v, want %v", err, tt.wantErr)
				}
				if len(f.pub.events) != 0 {
					t.Errorf("published %+v, want nothing", f.pub.events)
				}
			})
		}
	})

	t.Run("repository failure is passed on", func(t *testing.T) {
		f := newFixture()
		f.repo.fail = true
		_, err := f.svc.Create(ctx, f.member, f.listID, NewItem{ID: uuid.New(), Name: "Mehl"}, f.clock(t, 0, "anna"))
		if !errors.Is(err, errRepo) {
			t.Errorf("error = %v, want %v", err, errRepo)
		}
	})
}

func TestService_Update(t *testing.T) {
	ctx := context.Background()

	t.Run("a newer change wins and takes the new clock", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		clock := f.clock(t, 1, "ben")

		got, err := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some(" Hafermilch ")}, clock)

		if err != nil {
			t.Fatalf("Update() error = %v", err)
		}
		if got.Name != "Hafermilch" || got.Clocks[FieldName] != clock || got.ServerSeq <= it.ServerSeq {
			t.Errorf("Update() = %+v", got)
		}
		if *got.Quantity != 1 || got.Clocks[FieldQuantity] != f.clock(t, 0, "anna") {
			t.Errorf("other fields changed: %+v", got)
		}
	})

	t.Run("an older change loses and the item stays as it is", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)

		got, err := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some("Alt")}, f.clock(t, -1, "ben"))

		if err != nil {
			t.Fatalf("Update() error = %v", err)
		}
		if got.Name != "Milch" || got.ServerSeq != it.ServerSeq {
			t.Errorf("Update() = %+v, want the stored item untouched", got)
		}
	})

	t.Run("one change, one field wins and one loses", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		// The name is newer than the change that comes in later.
		if _, err := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some("Neu")}, f.clock(t, 10, "ben")); err != nil {
			t.Fatal(err)
		}

		got, err := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some("Mittel"), Quantity: Some(ptr(3.0))}, f.clock(t, 5, "anna"))

		if err != nil {
			t.Fatalf("Update() error = %v", err)
		}
		if got.Name != "Neu" || *got.Quantity != 3 {
			t.Errorf("Update() = name %q, quantity %v, want Neu and 3", got.Name, *got.Quantity)
		}
	})

	t.Run("changes to different fields both stay, whatever the order", func(t *testing.T) {
		for _, name := range []string{"quantity first", "checked first"} {
			t.Run(name, func(t *testing.T) {
				f := newFixture()
				it := f.create(t)
				quantity := func() error {
					_, err := f.svc.Update(ctx, f.member, it.ID, Change{Quantity: Some(ptr(2.0))}, f.clock(t, 1, "anna"))
					return err
				}
				checked := func() error {
					_, err := f.svc.Update(ctx, f.member, it.ID, Change{Checked: Some(true)}, f.clock(t, 2, "ben"))
					return err
				}
				first, second := quantity, checked
				if name == "checked first" {
					first, second = checked, quantity
				}
				if err := first(); err != nil {
					t.Fatal(err)
				}
				if err := second(); err != nil {
					t.Fatal(err)
				}

				got := f.repo.items[it.ID]
				if *got.Quantity != 2 || !got.Checked {
					t.Errorf("item = quantity %v, checked %t, want 2 and true", *got.Quantity, got.Checked)
				}
			})
		}
	})

	t.Run("checking records who and when, unchecking clears it", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)

		checked, err := f.svc.Update(ctx, f.member, it.ID, Change{Checked: Some(true)}, f.clock(t, 1, "ben"))
		if err != nil {
			t.Fatal(err)
		}
		if !checked.Checked || checked.CheckedBy == nil || *checked.CheckedBy != f.member ||
			checked.CheckedAt == nil || !checked.CheckedAt.Equal(serverNow) {
			t.Errorf("checked = %+v, want checked by the member at %v", checked, serverNow)
		}

		unchecked, err := f.svc.Update(ctx, f.member, it.ID, Change{Checked: Some(false)}, f.clock(t, 2, "ben"))
		if err != nil {
			t.Fatal(err)
		}
		if unchecked.Checked || unchecked.CheckedBy != nil || unchecked.CheckedAt != nil {
			t.Errorf("unchecked = %+v, want nobody and no time", unchecked)
		}
	})

	t.Run("a lost check does not touch who checked", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		if _, err := f.svc.Update(ctx, f.member, it.ID, Change{Checked: Some(false)}, f.clock(t, 5, "anna")); err != nil {
			t.Fatal(err)
		}

		got, err := f.svc.Update(ctx, f.member, it.ID, Change{Checked: Some(true)}, f.clock(t, 1, "ben"))

		if err != nil {
			t.Fatal(err)
		}
		if got.Checked || got.CheckedBy != nil {
			t.Errorf("item = %+v, want it still unchecked", got)
		}
	})

	t.Run("a field can be cleared", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)

		got, err := f.svc.Update(ctx, f.member, it.ID, Change{Quantity: Some[*float64](nil)}, f.clock(t, 1, "ben"))

		if err != nil {
			t.Fatal(err)
		}
		if got.Quantity != nil {
			t.Errorf("Quantity = %v, want nil", *got.Quantity)
		}
	})

	t.Run("a change to a deleted item is ignored", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		if _, err := f.svc.Delete(ctx, f.member, it.ID); err != nil {
			t.Fatal(err)
		}

		got, err := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some("Zombie")}, f.clock(t, 100, "ben"))

		if err != nil {
			t.Fatalf("Update() error = %v", err)
		}
		if !got.Deleted() || got.Name != "Milch" {
			t.Errorf("Update() = %+v, want the tombstone, unchanged", got)
		}
	})

	t.Run("a clock far in the future is limited to now", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		wrong := mustHLC(t, at.AddDate(1, 0, 0), 0, "ben")

		got, err := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some("Neu")}, wrong)

		if err != nil {
			t.Fatal(err)
		}
		if want := mustHLC(t, serverNow, 0, "ben"); got.Clocks[FieldName] != want {
			t.Errorf("clock = %q, want %q", got.Clocks[FieldName], want)
		}
	})

	t.Run("a winning change publishes the stored item", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		f.pub.events = nil

		got, err := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some("Hafermilch")}, f.clock(t, 1, "ben"))

		if err != nil {
			t.Fatal(err)
		}
		want := []publishedEvent{{"changed", fakeGroupID, f.member, got}}
		if !reflect.DeepEqual(f.pub.events, want) {
			t.Errorf("published %+v, want %+v", f.pub.events, want)
		}
		if got.ServerSeq <= it.ServerSeq {
			t.Errorf("serverSeq = %d, want more than %d", got.ServerSeq, it.ServerSeq)
		}
	})

	t.Run("a change that loses publishes nothing", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		f.pub.events = nil

		_, err := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some("Alt")}, f.clock(t, -1, "ben"))

		if err != nil {
			t.Fatal(err)
		}
		if len(f.pub.events) != 0 {
			t.Errorf("published %+v, want nothing", f.pub.events)
		}
	})

	t.Run("a change to a deleted item publishes nothing", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		if _, err := f.svc.Delete(ctx, f.member, it.ID); err != nil {
			t.Fatal(err)
		}
		f.pub.events = nil

		_, err := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some("Zombie")}, f.clock(t, 100, "ben"))

		if err != nil {
			t.Fatal(err)
		}
		if len(f.pub.events) != 0 {
			t.Errorf("published %+v, want nothing", f.pub.events)
		}
	})

	// The publish call comes after InTx returns. If it sat inside the
	// closure, it would run here before the commit failed.
	t.Run("a failed commit publishes nothing", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		f.pub.events = nil
		f.repo.failCommit = true

		_, err := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some("Neu")}, f.clock(t, 1, "ben"))

		if !errors.Is(err, errRepo) {
			t.Errorf("error = %v, want %v", err, errRepo)
		}
		if len(f.pub.events) != 0 {
			t.Errorf("published %+v, want nothing", f.pub.events)
		}
	})

	t.Run("errors publish nothing", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		f.pub.events = nil

		_, outsider := f.svc.Update(ctx, f.outsider, it.ID, Change{Name: Some("X")}, f.clock(t, 1, "ben"))
		_, invalid := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some(" ")}, f.clock(t, 1, "ben"))
		_, empty := f.svc.Update(ctx, f.member, it.ID, Change{}, f.clock(t, 1, "ben"))
		f.repo.fail = true
		_, failing := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some("X")}, f.clock(t, 1, "ben"))

		for _, err := range []error{outsider, invalid, empty, failing} {
			if err == nil {
				t.Error("an update succeeded, want every one to fail")
			}
		}
		if len(f.pub.events) != 0 {
			t.Errorf("published %+v, want nothing", f.pub.events)
		}
	})

	t.Run("outsider and unknown item are not found", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		for name, tc := range map[string]struct{ actor, item uuid.UUID }{
			"outsider":     {f.outsider, it.ID},
			"unknown item": {f.member, uuid.New()},
		} {
			_, err := f.svc.Update(ctx, tc.actor, tc.item, Change{Name: Some("X")}, f.clock(t, 1, "ben"))
			if !errors.Is(err, ErrNotFound) {
				t.Errorf("%s: error = %v, want %v", name, err, ErrNotFound)
			}
		}
		if f.repo.items[it.ID].Name != "Milch" {
			t.Error("the item was changed")
		}
	})

	t.Run("invalid input", func(t *testing.T) {
		tests := []struct {
			name    string
			change  Change
			clock   HLC
			wantErr error
		}{
			{"nothing to change", Change{}, "", ErrEmptyChange},
			{"empty name", Change{Name: Some(" ")}, "", ErrInvalidName},
			{"quantity zero", Change{Quantity: Some(ptr(0.0))}, "", ErrInvalidQuantity},
			{"unknown unit", Change{Unit: Some(ptr(Unit("cup")))}, "", ErrInvalidUnit},
			{"note over the limit", Change{Note: Some(ptr(strings.Repeat("a", MaxNoteLength+1)))}, "", ErrInvalidNote},
			{"invalid clock", Change{Name: Some("X")}, "nonsense", ErrInvalidHLC},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				f := newFixture()
				it := f.create(t)
				clock := tt.clock
				if clock == "" {
					clock = f.clock(t, 1, "ben")
				}
				_, err := f.svc.Update(ctx, f.member, it.ID, tt.change, clock)
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("error = %v, want %v", err, tt.wantErr)
				}
				if f.repo.items[it.ID].Name != "Milch" {
					t.Error("the item was changed")
				}
			})
		}
	})

	t.Run("outsider learns nothing about the rules", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		_, err := f.svc.Update(ctx, f.outsider, it.ID, Change{}, "nonsense")
		if !errors.Is(err, ErrNotFound) {
			t.Errorf("error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("repository failure is passed on", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		f.repo.fail = true
		_, err := f.svc.Update(ctx, f.member, it.ID, Change{Name: Some("X")}, f.clock(t, 1, "ben"))
		if !errors.Is(err, errRepo) {
			t.Errorf("error = %v, want %v", err, errRepo)
		}
	})
}

func TestService_Delete(t *testing.T) {
	ctx := context.Background()

	t.Run("turns the item into a tombstone, twice is harmless", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)

		first, err := f.svc.Delete(ctx, f.member, it.ID)
		if err != nil || !first.Deleted() {
			t.Fatalf("Delete() = %+v, %v, want a tombstone", first, err)
		}
		again, err := f.svc.Delete(ctx, f.member, it.ID)
		if err != nil || !again.Deleted() || again.ServerSeq != first.ServerSeq {
			t.Errorf("second Delete() = %+v, %v, want the same tombstone", again, err)
		}
	})

	t.Run("publishes the tombstone once, deleting twice publishes nothing more", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		f.pub.events = nil

		first, err := f.svc.Delete(ctx, f.member, it.ID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.svc.Delete(ctx, f.member, it.ID); err != nil {
			t.Fatal(err)
		}

		want := []publishedEvent{{"deleted", fakeGroupID, f.member, first}}
		if !reflect.DeepEqual(f.pub.events, want) {
			t.Errorf("published %+v, want %+v", f.pub.events, want)
		}
	})

	t.Run("outsider and unknown item publish nothing", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		f.pub.events = nil

		_, outsider := f.svc.Delete(ctx, f.outsider, it.ID)
		_, unknown := f.svc.Delete(ctx, f.member, uuid.New())

		if outsider == nil || unknown == nil {
			t.Errorf("errors = %v, %v, want both to fail", outsider, unknown)
		}
		if len(f.pub.events) != 0 {
			t.Errorf("published %+v, want nothing", f.pub.events)
		}
	})

	t.Run("outsider and unknown item are not found", func(t *testing.T) {
		f := newFixture()
		it := f.create(t)
		if _, err := f.svc.Delete(ctx, f.outsider, it.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("outsider: error = %v, want %v", err, ErrNotFound)
		}
		if _, err := f.svc.Delete(ctx, f.member, uuid.New()); !errors.Is(err, ErrNotFound) {
			t.Errorf("unknown item: error = %v, want %v", err, ErrNotFound)
		}
		if f.repo.items[it.ID].Deleted() {
			t.Error("the outsider deleted the item")
		}
	})
}

// check checks the item through the service.
func (f fixture) check(t *testing.T, it Item) Item {
	t.Helper()
	checked, err := f.svc.Update(context.Background(), f.member, it.ID, Change{Checked: Some(true)}, f.clock(t, 1, "anna"))
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	return checked
}

// idsOf returns the IDs of the items, sorted, to compare results that come
// in no particular order.
func idsOf(items []Item) []uuid.UUID {
	ids := make([]uuid.UUID, len(items))
	for i, it := range items {
		ids[i] = it.ID
	}
	slices.SortFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	return ids
}

func TestService_RemoveChecked(t *testing.T) {
	ctx := context.Background()

	t.Run("deletes the named items that are still checked and publishes them once", func(t *testing.T) {
		f := newFixture()
		milk := f.check(t, f.create(t))
		bread := f.check(t, f.create(t))
		open := f.create(t)                // named, but not checked
		unnamed := f.check(t, f.create(t)) // checked, but not named
		gone := f.check(t, f.create(t))    // named, but deleted already
		if _, err := f.svc.Delete(ctx, f.member, gone.ID); err != nil {
			t.Fatal(err)
		}
		foreign := Item{ID: uuid.New(), ListID: f.otherID, Name: "Fremd", Checked: true}
		f.repo.items[foreign.ID] = foreign

		got, err := f.svc.RemoveChecked(ctx, f.member, f.listID,
			[]uuid.UUID{milk.ID, bread.ID, open.ID, gone.ID, foreign.ID, uuid.New()})
		if err != nil {
			t.Fatalf("RemoveChecked() error = %v", err)
		}

		if want := idsOf([]Item{milk, bread}); !slices.Equal(idsOf(got), want) {
			t.Errorf("deleted %v, want %v", idsOf(got), want)
		}
		for _, it := range got {
			if !it.Deleted() || it.ServerSeq <= milk.ServerSeq {
				t.Errorf("%s = %+v, want a tombstone with a new serverSeq", it.Name, it)
			}
		}
		for _, kept := range []Item{open, unnamed, foreign} {
			if f.repo.items[kept.ID].Deleted() {
				t.Errorf("%s was deleted", kept.ID)
			}
		}
		want := []publishedBatch{{fakeGroupID, f.listID, f.member, got}}
		if !reflect.DeepEqual(f.pub.batches, want) {
			t.Errorf("published %+v, want %+v", f.pub.batches, want)
		}
	})

	t.Run("nothing to delete publishes nothing", func(t *testing.T) {
		f := newFixture()
		open := f.create(t)

		for name, ids := range map[string][]uuid.UUID{"no IDs": {}, "nothing checked": {open.ID}} {
			got, err := f.svc.RemoveChecked(ctx, f.member, f.listID, ids)
			if err != nil || len(got) != 0 {
				t.Errorf("%s: RemoveChecked() = %+v, %v, want nothing", name, got, err)
			}
		}
		if len(f.pub.batches) != 0 {
			t.Errorf("published %+v, want nothing", f.pub.batches)
		}
	})

	t.Run("an outsider is not found and deletes nothing", func(t *testing.T) {
		f := newFixture()
		milk := f.check(t, f.create(t))

		// Even with too many IDs: access comes first.
		for _, ids := range [][]uuid.UUID{{milk.ID}, make([]uuid.UUID, MaxRemoveItems+1)} {
			if _, err := f.svc.RemoveChecked(ctx, f.outsider, f.listID, ids); !errors.Is(err, ErrNotFound) {
				t.Errorf("error = %v, want %v", err, ErrNotFound)
			}
		}
		if f.repo.items[milk.ID].Deleted() || len(f.pub.batches) != 0 {
			t.Errorf("the outsider deleted %+v and published %+v", f.repo.items[milk.ID], f.pub.batches)
		}
	})

	t.Run("more than MaxRemoveItems IDs are refused", func(t *testing.T) {
		f := newFixture()
		milk := f.check(t, f.create(t))
		ids := make([]uuid.UUID, MaxRemoveItems+1)
		ids[0] = milk.ID

		if _, err := f.svc.RemoveChecked(ctx, f.member, f.listID, ids); !errors.Is(err, ErrTooManyItems) {
			t.Errorf("error = %v, want %v", err, ErrTooManyItems)
		}
		if _, err := f.svc.RemoveChecked(ctx, f.member, f.listID, ids[:MaxRemoveItems]); err != nil {
			t.Errorf("exactly MaxRemoveItems: error = %v", err)
		}
	})

	t.Run("a repository failure is returned and publishes nothing", func(t *testing.T) {
		f := newFixture()
		milk := f.check(t, f.create(t))
		f.repo.fail = true

		if _, err := f.svc.RemoveChecked(ctx, f.member, f.listID, []uuid.UUID{milk.ID}); !errors.Is(err, errRepo) {
			t.Errorf("error = %v, want %v", err, errRepo)
		}
		if len(f.pub.batches) != 0 {
			t.Errorf("published %+v, want nothing", f.pub.batches)
		}
	})
}

func TestNewService_nilPublisher(t *testing.T) {
	f := newFixture()
	svc := NewService(f.repo, fakeLists{f.listID: {f.member: true}}, nil)
	ctx := context.Background()
	id := uuid.New()

	if _, err := svc.Create(ctx, f.member, f.listID, NewItem{ID: id, Name: "Milch"}, f.clock(t, 0, "anna")); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if _, err := svc.Update(ctx, f.member, id, Change{Name: Some("Hafermilch")}, f.clock(t, 1, "anna")); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if _, err := svc.Update(ctx, f.member, id, Change{Checked: Some(true)}, f.clock(t, 2, "anna")); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if _, err := svc.RemoveChecked(ctx, f.member, f.listID, []uuid.UUID{id}); err != nil {
		t.Fatalf("RemoveChecked() error = %v", err)
	}
	if _, err := svc.Delete(ctx, f.member, id); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
}

func TestService_ListAndGet(t *testing.T) {
	ctx := context.Background()
	f := newFixture()
	kept := f.create(t)
	gone := f.create(t)
	if _, err := f.svc.Delete(ctx, f.member, gone.ID); err != nil {
		t.Fatal(err)
	}

	t.Run("list leaves out deleted items", func(t *testing.T) {
		items, err := f.svc.ListForList(ctx, f.member, f.listID)
		if err != nil || len(items) != 1 || items[0].ID != kept.ID {
			t.Errorf("ListForList() = %+v, %v, want only the kept item", items, err)
		}
	})

	t.Run("list for an outsider is not found", func(t *testing.T) {
		if _, err := f.svc.ListForList(ctx, f.outsider, f.listID); !errors.Is(err, ErrNotFound) {
			t.Errorf("error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("get returns a deleted item, too", func(t *testing.T) {
		got, err := f.svc.Get(ctx, f.member, gone.ID)
		if err != nil || !got.Deleted() {
			t.Errorf("Get() = %+v, %v, want the tombstone", got, err)
		}
	})

	t.Run("get for an outsider is not found", func(t *testing.T) {
		if _, err := f.svc.Get(ctx, f.outsider, kept.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("repository failure is passed on", func(t *testing.T) {
		f.repo.fail = true
		defer func() { f.repo.fail = false }()
		if _, err := f.svc.ListForList(ctx, f.member, f.listID); !errors.Is(err, errRepo) {
			t.Errorf("ListForList() error = %v, want %v", err, errRepo)
		}
		if _, err := f.svc.Get(ctx, f.member, kept.ID); !errors.Is(err, errRepo) {
			t.Errorf("Get() error = %v, want %v", err, errRepo)
		}
	})
}
