package item

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"mitbringsel/internal/group"
	"mitbringsel/internal/list"
	"mitbringsel/internal/platform/db/dbtest"
	"mitbringsel/internal/platform/db/sqlcgen"
)

// newTestUser stores a user and returns its ID. name keeps subjects unique
// across subtests that share one database.
func newTestUser(t *testing.T, pool *pgxpool.Pool, name string) uuid.UUID {
	t.Helper()
	u, err := sqlcgen.New(pool).UpsertUserByGoogleSub(context.Background(), sqlcgen.UpsertUserByGoogleSubParams{
		GoogleSub:   "test-" + name,
		Email:       name + "@example.com",
		DisplayName: name,
	})
	if err != nil {
		t.Fatalf("create user %s: %v", name, err)
	}
	return u.ID
}

func newItemID(t *testing.T) uuid.UUID {
	t.Helper()
	id, err := uuid.NewV7()
	if err != nil {
		t.Fatalf("new item id: %v", err)
	}
	return id
}

// storedSeqPublisher reads the item from the database, over a connection of
// its own, at the moment the service publishes. A publish before the commit
// would see the old row there.
type storedSeqPublisher struct {
	repo *PostgresRepository

	mu sync.Mutex
	// published and stored are the serverSeq of each event and the one the
	// database had at that moment; storeErrs are failed reads.
	published, stored []int64
	storeErrs         []error
}

func (p *storedSeqPublisher) ItemChanged(ctx context.Context, _, _ uuid.UUID, it Item) {
	p.record(ctx, it)
}

func (p *storedSeqPublisher) ItemDeleted(ctx context.Context, _, _ uuid.UUID, it Item) {
	p.record(ctx, it)
}

func (p *storedSeqPublisher) ItemsDeleted(ctx context.Context, _, _, _ uuid.UUID, tombstones []Item) {
	for _, it := range tombstones {
		p.record(ctx, it)
	}
}

func (p *storedSeqPublisher) record(ctx context.Context, it Item) {
	stored, err := p.repo.Get(ctx, it.ID)

	p.mu.Lock()
	defer p.mu.Unlock()
	p.published = append(p.published, it.ServerSeq)
	p.stored = append(p.stored, stored.ServerSeq)
	if err != nil {
		p.storeErrs = append(p.storeErrs, err)
	}
}

// itemsWithIDs returns items that only carry the IDs, for idsOf.
func itemsWithIDs(ids []uuid.UUID) []Item {
	items := make([]Item, len(ids))
	for i, id := range ids {
		items[i] = Item{ID: id}
	}
	return items
}

// TestPostgresRepository shares one container across its subtests; each
// subtest creates its own users and lists. The item service runs on the real
// list and group services, so access is checked against the database, too.
func TestPostgresRepository(t *testing.T) {
	pool := dbtest.NewPool(t)
	ctx := context.Background()
	groupRepo := group.NewPostgresRepository(pool)
	groups := group.NewService(groupRepo, nil)
	lists := list.NewService(list.NewPostgresRepository(sqlcgen.New(pool)), groupRepo, nil)
	repo := NewPostgresRepository(pool)
	svc := NewService(repo, lists, nil)

	// newList makes a user with a group and a list, and returns both.
	newList := func(t *testing.T, name string) (user, listID uuid.UUID) {
		t.Helper()
		user = newTestUser(t, pool, name)
		g, err := groups.Create(ctx, user, "WG")
		if err != nil {
			t.Fatalf("create group: %v", err)
		}
		l, err := lists.Create(ctx, user, g.ID, "Supermarkt", "")
		if err != nil {
			t.Fatalf("create list: %v", err)
		}
		return user, l.ID
	}
	now := time.Now()
	clock := func(t *testing.T, offset time.Duration, node string) HLC {
		t.Helper()
		return mustHLC(t, now.Add(offset), 0, node)
	}

	t.Run("create, get and list round trip every field", func(t *testing.T) {
		anna, listID := newList(t, "create-anna")
		id := newItemID(t)
		c := clock(t, 0, "anna")

		created, err := svc.Create(ctx, anna, listID, NewItem{
			ID: id, Name: "Mehl", Quantity: ptr(0.1), Unit: ptr(UnitKilogram), Note: ptr("Typ 405"),
		}, c)
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}
		second, err := svc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: "Eier", Quantity: ptr(1.5)}, c)
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		got, err := svc.Get(ctx, anna, id)
		if err != nil {
			t.Fatalf("Get() error = %v", err)
		}
		if got.ID != id || got.ListID != listID || got.Name != "Mehl" || got.Quantity == nil || *got.Quantity != 0.1 ||
			got.Unit == nil || *got.Unit != UnitKilogram || got.Note == nil || *got.Note != "Typ 405" || got.Checked {
			t.Errorf("Get() = %+v", got)
		}
		if got.CreatedBy == nil || *got.CreatedBy != anna || got.CreatedAt.IsZero() || got.ServerSeq == 0 {
			t.Errorf("Get() = %+v, want creator, time and server_seq", got)
		}
		for _, f := range []Field{FieldName, FieldQuantity, FieldUnit, FieldNote, FieldChecked} {
			if got.Clocks[f] != c {
				t.Errorf("clock of %s = %q, want %q", f, got.Clocks[f], c)
			}
		}
		if second.ServerSeq <= created.ServerSeq {
			t.Errorf("server_seq = %d after %d, want it to grow", second.ServerSeq, created.ServerSeq)
		}

		items, err := svc.ListForList(ctx, anna, listID)
		if err != nil || len(items) != 2 || items[0].ID != id || items[1].ID != second.ID {
			t.Errorf("ListForList() = %+v, %v, want mehl then eier", items, err)
		}
		if items[1].Unit != nil || items[1].Note != nil {
			t.Errorf("Eier = %+v, want no unit and no note", items[1])
		}
	})

	t.Run("a repeated create returns the stored item, a foreign ID is taken", func(t *testing.T) {
		anna, listID := newList(t, "repeat-anna")
		_, otherList := newList(t, "repeat-ben")
		id := newItemID(t)
		first, err := svc.Create(ctx, anna, listID, NewItem{ID: id, Name: "Mehl"}, clock(t, 0, "anna"))
		if err != nil {
			t.Fatalf("Create() error = %v", err)
		}

		again, err := svc.Create(ctx, anna, listID, NewItem{ID: id, Name: "Anders"}, clock(t, time.Minute, "anna"))
		if err != nil || again.Name != "Mehl" || again.ServerSeq != first.ServerSeq {
			t.Errorf("repeated Create() = %+v, %v, want the stored item", again, err)
		}

		// Ben creates in his own list with Anna's ID.
		ben := newTestUser(t, pool, "repeat-ben")
		_, err = svc.Create(ctx, ben, otherList, NewItem{ID: id, Name: "Fremd"}, clock(t, 0, "ben"))
		if !errors.Is(err, ErrIDTaken) {
			t.Errorf("Create() with a foreign ID error = %v, want %v", err, ErrIDTaken)
		}
		if _, err := repo.Create(ctx, Item{ID: id, ListID: listID, Name: "x", Clocks: Clocks{}}); !errors.Is(err, ErrIDTaken) {
			t.Errorf("repo.Create() of an existing ID error = %v, want %v", err, ErrIDTaken)
		}
	})

	t.Run("only winning fields are written and the clocks are merged", func(t *testing.T) {
		anna, listID := newList(t, "update-anna")
		it, err := svc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: "Milch", Quantity: ptr(1.0), Unit: ptr(UnitLiter)}, clock(t, 0, "anna"))
		if err != nil {
			t.Fatal(err)
		}

		// Newer name, older quantity: the name changes, the quantity stays.
		if _, err := svc.Update(ctx, anna, it.ID, Change{Name: Some("Hafermilch")}, clock(t, 2*time.Minute, "ben")); err != nil {
			t.Fatal(err)
		}
		got, err := svc.Update(ctx, anna, it.ID, Change{Quantity: Some(ptr(9.0)), Name: Some("Veraltet")}, clock(t, time.Minute, "anna"))
		if err != nil {
			t.Fatal(err)
		}

		if got.Name != "Hafermilch" || *got.Quantity != 9 || *got.Unit != UnitLiter {
			t.Errorf("item = %q, %v, %v; want Hafermilch, 9, l", got.Name, *got.Quantity, *got.Unit)
		}
		if got.Clocks[FieldName] != clock(t, 2*time.Minute, "ben") ||
			got.Clocks[FieldQuantity] != clock(t, time.Minute, "anna") ||
			got.Clocks[FieldUnit] != clock(t, 0, "anna") {
			t.Errorf("clocks = %v, want name from ben, quantity from the second change, unit untouched", got.Clocks)
		}
		stored, err := svc.Get(ctx, anna, it.ID)
		if err != nil || stored.Name != got.Name || stored.ServerSeq != got.ServerSeq {
			t.Errorf("Get() = %+v, %v, want what Update returned", stored, err)
		}
	})

	t.Run("fields can be cleared and checking is stored with who and when", func(t *testing.T) {
		anna, listID := newList(t, "check-anna")
		it, err := svc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: "Milch", Quantity: ptr(1.0), Unit: ptr(UnitLiter), Note: ptr("bio")}, clock(t, 0, "anna"))
		if err != nil {
			t.Fatal(err)
		}

		cleared, err := svc.Update(ctx, anna, it.ID, Change{
			Quantity: Some[*float64](nil), Unit: Some[*Unit](nil), Note: Some[*string](nil), Checked: Some(true),
		}, clock(t, time.Minute, "anna"))
		if err != nil {
			t.Fatal(err)
		}
		if cleared.Quantity != nil || cleared.Unit != nil || cleared.Note != nil {
			t.Errorf("item = %+v, want quantity, unit and note cleared", cleared)
		}
		if !cleared.Checked || cleared.CheckedBy == nil || *cleared.CheckedBy != anna || cleared.CheckedAt == nil {
			t.Errorf("item = %+v, want checked by anna with a time", cleared)
		}

		unchecked, err := svc.Update(ctx, anna, it.ID, Change{Checked: Some(false)}, clock(t, 2*time.Minute, "anna"))
		if err != nil {
			t.Fatal(err)
		}
		if unchecked.Checked || unchecked.CheckedBy != nil || unchecked.CheckedAt != nil {
			t.Errorf("item = %+v, want unchecked with nobody and no time", unchecked)
		}
	})

	t.Run("delete leaves a tombstone that ignores later edits", func(t *testing.T) {
		anna, listID := newList(t, "delete-anna")
		keep, err := svc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: "Bleibt"}, clock(t, 0, "anna"))
		if err != nil {
			t.Fatal(err)
		}
		gone, err := svc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: "Geht"}, clock(t, 0, "anna"))
		if err != nil {
			t.Fatal(err)
		}

		tombstone, err := svc.Delete(ctx, anna, gone.ID)
		if err != nil || !tombstone.Deleted() || tombstone.ServerSeq <= gone.ServerSeq {
			t.Fatalf("Delete() = %+v, %v, want a tombstone with a larger server_seq", tombstone, err)
		}
		again, err := svc.Delete(ctx, anna, gone.ID)
		if err != nil || !again.DeletedAt.Equal(*tombstone.DeletedAt) || again.ServerSeq != tombstone.ServerSeq {
			t.Errorf("second Delete() = %+v, %v, want nothing changed", again, err)
		}

		after, err := svc.Update(ctx, anna, gone.ID, Change{Name: Some("Zombie")}, clock(t, time.Minute, "ben"))
		if err != nil || !after.Deleted() || after.Name != "Geht" {
			t.Errorf("Update() of a tombstone = %+v, %v, want it unchanged", after, err)
		}

		items, err := svc.ListForList(ctx, anna, listID)
		if err != nil || len(items) != 1 || items[0].ID != keep.ID {
			t.Errorf("ListForList() = %+v, %v, want only the kept item", items, err)
		}
	})

	t.Run("remove checked deletes the named checked items, each with its own server_seq", func(t *testing.T) {
		anna, listID := newList(t, "remove-anna")
		_, otherList := newList(t, "remove-ben")
		create := func(list uuid.UUID, name string, checked bool) Item {
			t.Helper()
			it, err := repo.Create(ctx, Item{ID: newItemID(t), ListID: list, Name: name, Clocks: Clocks{}})
			if err != nil {
				t.Fatal(err)
			}
			if checked {
				if it, err = repo.Apply(ctx, it.ID, Update{Change: Change{Checked: Some(true)}, Clocks: Clocks{}}); err != nil {
					t.Fatal(err)
				}
			}
			return it
		}
		milk := create(listID, "Milch", true)
		bread := create(listID, "Brot", true)
		open := create(listID, "Offen", false)
		unnamed := create(listID, "Nicht genannt", true)
		foreign := create(otherList, "Fremd", true)

		got, err := svc.RemoveChecked(ctx, anna, listID, []uuid.UUID{milk.ID, bread.ID, open.ID, foreign.ID, newItemID(t)})
		if err != nil {
			t.Fatalf("RemoveChecked() error = %v", err)
		}

		if want := idsOf([]Item{milk, bread}); !slices.Equal(idsOf(got), want) {
			t.Fatalf("deleted %v, want %v", idsOf(got), want)
		}
		if got[0].ServerSeq == got[1].ServerSeq {
			t.Errorf("both tombstones have server_seq %d, want one each", got[0].ServerSeq)
		}
		for _, it := range got {
			if !it.Deleted() || it.ServerSeq <= foreign.ServerSeq {
				t.Errorf("%s = %+v, want a tombstone with a new server_seq", it.Name, it)
			}
		}
		left, err := svc.ListForList(ctx, anna, listID)
		if want := idsOf([]Item{open, unnamed}); err != nil || !slices.Equal(idsOf(left), want) {
			t.Errorf("ListForList() = %v, %v, want %v", idsOf(left), err, want)
		}
		if f, err := repo.Get(ctx, foreign.ID); err != nil || f.Deleted() {
			t.Errorf("item of another list = %+v, %v, want it kept", f, err)
		}

		again, err := svc.RemoveChecked(ctx, anna, listID, []uuid.UUID{milk.ID, bread.ID})
		if err != nil || len(again) != 0 {
			t.Errorf("second RemoveChecked() = %+v, %v, want nothing", again, err)
		}
	})

	// Two members press "remove" at the same moment. The rows are locked in
	// ID order, so neither waits for the other in a circle (a deadlock would
	// fail one of them), and each item is deleted exactly once.
	t.Run("concurrent remove checked deletes every item once", func(t *testing.T) {
		anna, listID := newList(t, "remove-race-anna")
		for round := range 10 {
			var ids []uuid.UUID
			for range 20 {
				it, err := repo.Create(ctx, Item{ID: newItemID(t), ListID: listID, Name: "x", Clocks: Clocks{}})
				if err != nil {
					t.Fatal(err)
				}
				if _, err := repo.Apply(ctx, it.ID, Update{Change: Change{Checked: Some(true)}, Clocks: Clocks{}}); err != nil {
					t.Fatal(err)
				}
				ids = append(ids, it.ID)
			}
			reversed := slices.Clone(ids)
			slices.Reverse(reversed)

			var wg sync.WaitGroup
			start := make(chan struct{})
			results := make([][]Item, 2)
			for i, order := range [][]uuid.UUID{ids, reversed} {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					got, err := svc.RemoveChecked(ctx, anna, listID, order)
					if err != nil {
						t.Errorf("round %d: RemoveChecked() error = %v", round, err)
					}
					results[i] = got
				}()
			}
			close(start)
			wg.Wait()

			if all := idsOf(append(results[0], results[1]...)); !slices.Equal(all, idsOf(itemsWithIDs(ids))) {
				t.Fatalf("round %d: deleted %d items in total, want each of the %d once", round, len(all), len(ids))
			}
		}
	})

	t.Run("outsiders see nothing", func(t *testing.T) {
		anna, listID := newList(t, "access-anna")
		ben := newTestUser(t, pool, "access-ben")
		it, err := svc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: "Milch"}, clock(t, 0, "anna"))
		if err != nil {
			t.Fatal(err)
		}

		if _, err := svc.Get(ctx, ben, it.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() error = %v, want %v", err, ErrNotFound)
		}
		if _, err := svc.ListForList(ctx, ben, listID); !errors.Is(err, ErrNotFound) {
			t.Errorf("ListForList() error = %v, want %v", err, ErrNotFound)
		}
		if _, err := svc.Create(ctx, ben, listID, NewItem{ID: newItemID(t), Name: "x"}, clock(t, 0, "ben")); !errors.Is(err, ErrNotFound) {
			t.Errorf("Create() error = %v, want %v", err, ErrNotFound)
		}
		if _, err := svc.Update(ctx, ben, it.ID, Change{Name: Some("x")}, clock(t, time.Minute, "ben")); !errors.Is(err, ErrNotFound) {
			t.Errorf("Update() error = %v, want %v", err, ErrNotFound)
		}
		if _, err := svc.Delete(ctx, ben, it.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("Delete() error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("the items of a group are those of its active lists", func(t *testing.T) {
		anna, first := newList(t, "group-anna")
		l, err := lists.Get(ctx, anna, first)
		if err != nil {
			t.Fatal(err)
		}
		second, err := lists.Create(ctx, anna, l.GroupID, "Baumarkt", "")
		if err != nil {
			t.Fatal(err)
		}
		archived, err := lists.Create(ctx, anna, l.GroupID, "Weihnachten", "")
		if err != nil {
			t.Fatal(err)
		}
		empty, err := lists.Create(ctx, anna, l.GroupID, "Leer", "")
		if err != nil {
			t.Fatal(err)
		}
		create := func(listID uuid.UUID, name string) Item {
			t.Helper()
			it, err := svc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: name}, clock(t, 0, "anna"))
			if err != nil {
				t.Fatal(err)
			}
			return it
		}
		milk := create(first, "Milch")
		nails := create(second.ID, "Nägel")
		create(archived.ID, "Kerzen")
		gone := create(first, "Mehl")
		if _, err := svc.Delete(ctx, anna, gone.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := lists.Archive(ctx, anna, archived.ID); err != nil {
			t.Fatal(err)
		}
		// Another household's items stay out.
		ben, foreign := newList(t, "group-ben")
		if _, err := svc.Create(ctx, ben, foreign, NewItem{ID: newItemID(t), Name: "Käse"}, clock(t, 0, "ben")); err != nil {
			t.Fatal(err)
		}

		got, err := svc.ListForGroup(ctx, anna, l.GroupID)

		if err != nil {
			t.Fatalf("ListForGroup() error = %v", err)
		}
		items := got.Items
		if len(items) != 2 || items[0].ID != milk.ID || items[1].ID != nails.ID {
			t.Errorf("ListForGroup() = %+v, want Milch and Nägel, oldest first", items)
		}
		// The active lists are covered, the empty one too; the archived one is not.
		covered := map[uuid.UUID]bool{}
		for _, id := range got.ListIDs {
			covered[id] = true
		}
		if len(covered) != 3 || !covered[first] || !covered[second.ID] || !covered[empty.ID] || covered[archived.ID] {
			t.Errorf("ListForGroup() listIDs = %v, want the first, second and empty list", got.ListIDs)
		}
		if _, err := svc.ListForGroup(ctx, ben, l.GroupID); !errors.Is(err, ErrGroupNotFound) {
			t.Errorf("ListForGroup() for an outsider error = %v, want %v", err, ErrGroupNotFound)
		}
	})

	t.Run("the cleanup removes old tombstones only", func(t *testing.T) {
		anna, listID := newList(t, "tombstones-anna")
		create := func(name string) Item {
			t.Helper()
			it, err := svc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: name}, clock(t, 0, "anna"))
			if err != nil {
				t.Fatal(err)
			}
			return it
		}
		live, old, recent := create("Milch"), create("Mehl"), create("Eier")
		for _, it := range []Item{old, recent} {
			if _, err := svc.Delete(ctx, anna, it.ID); err != nil {
				t.Fatal(err)
			}
		}
		// Backdate one tombstone past the retention. Other subtests share
		// the database, so the count is not checked, only these items.
		if _, err := pool.Exec(ctx, "UPDATE items SET deleted_at = now() - interval '31 days' WHERE id = $1", old.ID); err != nil {
			t.Fatalf("backdate tombstone: %v", err)
		}

		if _, err := svc.DeleteOldTombstones(ctx); err != nil {
			t.Fatalf("DeleteOldTombstones() error = %v", err)
		}

		if _, err := repo.Get(ctx, old.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() of the old tombstone error = %v, want %v", err, ErrNotFound)
		}
		if got, err := repo.Get(ctx, recent.ID); err != nil || !got.Deleted() {
			t.Errorf("Get() of the recent tombstone = %+v, %v, want it kept", got, err)
		}
		if got, err := repo.Get(ctx, live.ID); err != nil || got.Deleted() {
			t.Errorf("Get() of the live item = %+v, %v, want it kept", got, err)
		}
	})

	t.Run("deleting the list takes the items along", func(t *testing.T) {
		anna, listID := newList(t, "cascade-anna")
		it, err := svc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: "Milch"}, clock(t, 0, "anna"))
		if err != nil {
			t.Fatal(err)
		}
		if err := lists.Delete(ctx, anna, listID); err != nil {
			t.Fatalf("delete list: %v", err)
		}
		if _, err := repo.Get(ctx, it.ID); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() after deleting the list error = %v, want %v", err, ErrNotFound)
		}
	})

	t.Run("unknown items are not found", func(t *testing.T) {
		unknown := uuid.New()
		if _, err := repo.Get(ctx, unknown); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() error = %v, want %v", err, ErrNotFound)
		}
		if _, err := repo.Apply(ctx, unknown, Update{Clocks: Clocks{}}); !errors.Is(err, ErrNotFound) {
			t.Errorf("Apply() error = %v, want %v", err, ErrNotFound)
		}
		if _, err := repo.MarkDeleted(ctx, unknown); !errors.Is(err, ErrNotFound) {
			t.Errorf("MarkDeleted() error = %v, want %v", err, ErrNotFound)
		}
	})

	// Two devices change the same field at the same moment. The row lock
	// makes the second one merge against the first one's result, so the
	// newer clock wins whichever transaction runs first. Without the lock
	// both would read the old clock and the last write would win, even if
	// its clock is older. Repeated to give a missing lock a chance to show.
	t.Run("publishes only after the commit", func(t *testing.T) {
		anna, listID := newList(t, "publish-anna")
		pub := &storedSeqPublisher{repo: NewPostgresRepository(pool)}
		pubSvc := NewService(repo, lists, pub)
		it, err := pubSvc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: "Milch"}, clock(t, 0, "anna"))
		if err != nil {
			t.Fatal(err)
		}
		updated, err := pubSvc.Update(ctx, anna, it.ID, Change{Name: Some("Hafermilch")}, clock(t, time.Minute, "anna"))
		if err != nil {
			t.Fatal(err)
		}
		deleted, err := pubSvc.Delete(ctx, anna, it.ID)
		if err != nil {
			t.Fatal(err)
		}
		bread, err := pubSvc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: "Brot"}, clock(t, 0, "anna"))
		if err != nil {
			t.Fatal(err)
		}
		checked, err := pubSvc.Update(ctx, anna, bread.ID, Change{Checked: Some(true)}, clock(t, time.Minute, "anna"))
		if err != nil {
			t.Fatal(err)
		}
		removed, err := pubSvc.RemoveChecked(ctx, anna, listID, []uuid.UUID{checked.ID})
		if err != nil || len(removed) != 1 {
			t.Fatalf("RemoveChecked() = %+v, %v, want one tombstone", removed, err)
		}

		pub.mu.Lock()
		defer pub.mu.Unlock()
		if len(pub.storeErrs) != 0 {
			t.Fatalf("reading in the publisher failed: %v", pub.storeErrs)
		}
		want := []int64{it.ServerSeq, updated.ServerSeq, deleted.ServerSeq,
			bread.ServerSeq, checked.ServerSeq, removed[0].ServerSeq}
		if !slices.Equal(pub.published, want) {
			t.Errorf("published serverSeqs = %v, want %v (create, update, delete, create, check, remove checked)", pub.published, want)
		}
		if !slices.Equal(pub.stored, want) {
			t.Errorf("serverSeqs in the database at publishing = %v, want %v", pub.stored, want)
		}
	})

	t.Run("concurrent changes to one field: the newer clock wins", func(t *testing.T) {
		anna, listID := newList(t, "race-anna")
		for i := range 25 {
			it, err := svc.Create(ctx, anna, listID, NewItem{ID: newItemID(t), Name: "Start"}, clock(t, 0, "anna"))
			if err != nil {
				t.Fatal(err)
			}
			older, newer := clock(t, time.Minute, "anna"), clock(t, 2*time.Minute, "ben")

			var wg sync.WaitGroup
			start := make(chan struct{})
			for name, c := range map[string]HLC{"Aelter": older, "Neuer": newer} {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					if _, err := svc.Update(ctx, anna, it.ID, Change{Name: Some(name)}, c); err != nil {
						t.Errorf("Update(%s) error = %v", name, err)
					}
				}()
			}
			close(start)
			wg.Wait()

			got, err := svc.Get(ctx, anna, it.ID)
			if err != nil {
				t.Fatal(err)
			}
			if got.Name != "Neuer" || got.Clocks[FieldName] != newer {
				t.Fatalf("round %d: name %q with clock %q, want Neuer with %q", i, got.Name, got.Clocks[FieldName], newer)
			}
		}
	})
}
