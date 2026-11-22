package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"mitbringsel/internal/config"
	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/item"
	"mitbringsel/internal/user"
)

var (
	testItemID = uuid.MustParse("0190a8c4-0000-7000-8000-0000000000c1")
	itemTime   = time.Date(2026, time.March, 3, 8, 0, 0, 0, testZone)
	// testItemClock is what the fake clock issues for every REST change.
	testItemClock = item.HLC("0000019a2b3c4d5e-0000-srvtest")
)

// fakeItemClock always issues the same clock.
type fakeItemClock struct{}

func (fakeItemClock) Next() item.HLC { return testItemClock }

// fakeItems returns the configured items or error for every method and
// records the calls, so tests can check what the handler passed on.
type fakeItems struct {
	items []item.Item
	// group is what ListForGroup returns.
	group item.GroupItems
	err   error

	// calls lists the methods that were called, with their arguments.
	calls []string
	// created is the NewItem of the last Create.
	created item.NewItem
}

func (f *fakeItems) record(format string, args ...any) {
	f.calls = append(f.calls, fmt.Sprintf(format, args...))
}

func (f *fakeItems) first() (item.Item, error) {
	if f.err != nil {
		return item.Item{}, f.err
	}
	return f.items[0], nil
}

func (f *fakeItems) Create(_ context.Context, actor, listID uuid.UUID, n item.NewItem, clock item.HLC) (item.Item, error) {
	f.record("Create %s %s %s", actor, listID, clock)
	f.created = n
	return f.first()
}

func (f *fakeItems) ListForList(_ context.Context, actor, listID uuid.UUID) ([]item.Item, error) {
	f.record("ListForList %s %s", actor, listID)
	return f.items, f.err
}

func (f *fakeItems) ListForGroup(_ context.Context, actor, groupID uuid.UUID) (item.GroupItems, error) {
	f.record("ListForGroup %s %s", actor, groupID)
	return f.group, f.err
}

func (f *fakeItems) Get(_ context.Context, actor, itemID uuid.UUID) (item.Item, error) {
	f.record("Get %s %s", actor, itemID)
	return f.first()
}

func (f *fakeItems) Update(_ context.Context, actor, itemID uuid.UUID, c item.Change, clock item.HLC) (item.Item, error) {
	f.record("Update %s %s %s [%s]", actor, itemID, clock, describeChange(c))
	return f.first()
}

func (f *fakeItems) Delete(_ context.Context, actor, itemID uuid.UUID) (item.Item, error) {
	f.record("Delete %s %s", actor, itemID)
	return f.first()
}

func (f *fakeItems) RemoveChecked(_ context.Context, actor, listID uuid.UUID, itemIDs []uuid.UUID) ([]item.Item, error) {
	f.record("RemoveChecked %s %s %v", actor, listID, itemIDs)
	return f.items, f.err
}

// describeChange writes the fields a change sets, one "field=value" each;
// null stands for "remove the value".
func describeChange(c item.Change) string {
	var parts []string
	if c.Name.Set {
		parts = append(parts, "name="+c.Name.Value)
	}
	if c.Quantity.Set {
		parts = append(parts, "quantity="+describePtr(c.Quantity.Value))
	}
	if c.Unit.Set {
		parts = append(parts, "unit="+describePtr(c.Unit.Value))
	}
	if c.Note.Set {
		parts = append(parts, "note="+describePtr(c.Note.Value))
	}
	if c.Checked.Set {
		parts = append(parts, fmt.Sprintf("checked=%t", c.Checked.Value))
	}
	return strings.Join(parts, " ")
}

func describePtr[T any](p *T) string {
	if p == nil {
		return "null"
	}
	return fmt.Sprint(*p)
}

// testItem is a checked item with every field set.
func testItem() item.Item {
	checkedAt := itemTime.Add(time.Hour)
	checkedBy := testMemberID
	creator := testUserID
	updater := testMemberID
	unit := item.UnitKilogram
	return item.Item{
		ID:        testItemID,
		ListID:    testListID,
		Name:      "Mehl",
		Quantity:  ptr(0.5),
		Unit:      &unit,
		Note:      ptr("Typ 405"),
		Checked:   true,
		CheckedBy: &checkedBy,
		CheckedAt: &checkedAt,
		CreatedBy: &creator,
		CreatedAt: itemTime,
		UpdatedBy: &updater,
		UpdatedAt: itemTime.Add(2 * time.Hour),
		ServerSeq: 42,
		Clocks: item.Clocks{
			item.FieldName:     "0000019a2b3c4d5e-0000-anna",
			item.FieldQuantity: "0000019a2b3c4d5f-0001-anna",
			item.FieldUnit:     "0000019a2b3c4d60-0000-ben",
			item.FieldNote:     "0000019a2b3c4d61-0000-ben",
			item.FieldChecked:  "0000019a2b3c4d62-0000-ben",
		},
	}
}

func ptr[T any](v T) *T { return &v }

// itemRequest sends a request through the real router with a valid session
// cookie, so routing, requireUser and the handler run together.
func itemRequest(t *testing.T, items ItemService, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	router := NewRouter(Deps{
		Env:       config.EnvDevelopment,
		DB:        fakePinger{},
		Sessions:  &fakeSessions{fakeValidator: fakeValidator{validToken: groupToken}},
		Users:     &fakeUsers{users: map[uuid.UUID]user.User{testUserID: testUser()}},
		Items:     items,
		ItemClock: fakeItemClock{},
	})
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: testCookieName, Value: groupToken})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func listItemsPathFor() string { return listPathFor("/items") }

func groupItemsPathFor() string { return groupPathFor("/items") }

func itemPathFor() string { return "/api/v1/items/" + testItemID.String() }

func removeCheckedPathFor() string { return listPathFor("/items/remove-checked") }

func TestRemoveCheckedItems(t *testing.T) {
	t.Run("passes the IDs on and answers the deleted items", func(t *testing.T) {
		other := uuid.MustParse("0190a8c4-0000-7000-8000-0000000000f2")
		tombstone := testItem()
		tombstone.DeletedAt = ptr(itemTime)
		tombstone.ServerSeq = 43
		items := &fakeItems{items: []item.Item{tombstone}}
		body := fmt.Sprintf(`{"itemIds":[%q,%q]}`, testItemID, other)

		rec := itemRequest(t, items, http.MethodPost, removeCheckedPathFor(), body)

		want := fmt.Sprintf(`{"items":[{"itemId":%q,"serverSeq":43}]}`, testItemID)
		if got := strings.TrimSpace(rec.Body.String()); rec.Code != http.StatusOK || got != want {
			t.Errorf("status = %d, body = %s, want 200 %s", rec.Code, got, want)
		}
		wantCall := fmt.Sprintf("RemoveChecked %s %s [%s %s]", testUserID, testListID, testItemID, other)
		if len(items.calls) != 1 || items.calls[0] != wantCall {
			t.Errorf("calls = %q, want [%q]", items.calls, wantCall)
		}
	})

	t.Run("nothing deleted is an empty array, not null", func(t *testing.T) {
		rec := itemRequest(t, &fakeItems{}, http.MethodPost, removeCheckedPathFor(), `{"itemIds":[]}`)

		if got := strings.TrimSpace(rec.Body.String()); rec.Code != http.StatusOK || got != `{"items":[]}` {
			t.Errorf("status = %d, body = %s", rec.Code, got)
		}
	})

	t.Run("500 IDs fit into the body", func(t *testing.T) {
		ids := make([]string, item.MaxRemoveItems)
		for i := range ids {
			ids[i] = fmt.Sprintf("%q", uuid.New())
		}
		// Indented like a pretty-printing client would send it.
		body := "{\n  \"itemIds\": [\n    " + strings.Join(ids, ",\n    ") + "\n  ]\n}"

		rec := itemRequest(t, &fakeItems{}, http.MethodPost, removeCheckedPathFor(), body)

		if rec.Code != http.StatusOK {
			t.Errorf("status = %d, body = %s, want 200", rec.Code, rec.Body)
		}
	})
}

func TestItemResponses(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		wantStatus int
		wantCall   string
	}{
		{
			name: "get", method: http.MethodGet, path: itemPathFor(),
			wantStatus: http.StatusOK,
			wantCall:   fmt.Sprintf("Get %s %s", testUserID, testItemID),
		},
		{
			name: "create", method: http.MethodPost, path: listItemsPathFor(), body: `{"id":"` + testItemID.String() + `","name":"Mehl"}`,
			wantStatus: http.StatusCreated,
			wantCall:   fmt.Sprintf("Create %s %s %s", testUserID, testListID, testItemClock),
		},
		{
			name: "update", method: http.MethodPatch, path: itemPathFor(), body: `{"name":"Mehl"}`,
			wantStatus: http.StatusOK,
			wantCall:   fmt.Sprintf("Update %s %s %s [name=Mehl]", testUserID, testItemID, testItemClock),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items := &fakeItems{items: []item.Item{testItem()}}

			rec := itemRequest(t, items, tt.method, tt.path, tt.body)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tt.wantStatus, rec.Body)
			}
			if len(items.calls) != 1 || items.calls[0] != tt.wantCall {
				t.Errorf("calls = %q, want [%q]", items.calls, tt.wantCall)
			}
			requireUTCTimestamps(t, rec.Body.Bytes())
			var got apigen.Item
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode body %s: %v", rec.Body, err)
			}
			if got.ID != testItemID || got.ListID != testListID || got.Name != "Mehl" || got.ServerSeq != 42 || !got.Checked {
				t.Errorf("item = %+v", got)
			}
			if got.Quantity == nil || *got.Quantity != 0.5 || got.Unit == nil || *got.Unit != apigen.Unit("kg") ||
				got.Note == nil || *got.Note != "Typ 405" {
				t.Errorf("quantity, unit, note = %v, %v, %v", got.Quantity, got.Unit, got.Note)
			}
			if got.CheckedBy == nil || *got.CheckedBy != testMemberID || got.CheckedAt == nil ||
				got.CreatedBy == nil || *got.CreatedBy != testUserID ||
				got.UpdatedBy == nil || *got.UpdatedBy != testMemberID || !got.UpdatedAt.Equal(itemTime.Add(2*time.Hour)) {
				t.Errorf("checkedBy, checkedAt, createdBy, updatedBy, updatedAt = %v, %v, %v, %v, %v",
					got.CheckedBy, got.CheckedAt, got.CreatedBy, got.UpdatedBy, got.UpdatedAt)
			}
			if got.Clocks.Name != "0000019a2b3c4d5e-0000-anna" || got.Clocks.Checked != "0000019a2b3c4d62-0000-ben" {
				t.Errorf("clocks = %+v", got.Clocks)
			}
		})
	}

	t.Run("an item without optional values has null, not missing", func(t *testing.T) {
		plain := item.Item{ID: testItemID, ListID: testListID, Name: "Brot", CreatedAt: itemTime, UpdatedAt: itemTime, Clocks: item.Clocks{}}

		rec := itemRequest(t, &fakeItems{items: []item.Item{plain}}, http.MethodGet, itemPathFor(), "")

		for _, field := range []string{"quantity", "unit", "note", "checkedBy", "checkedAt", "createdBy", "updatedBy"} {
			if !strings.Contains(rec.Body.String(), `"`+field+`":null`) {
				t.Errorf("body %s lacks %s:null", rec.Body, field)
			}
		}
	})
}

func TestListItems(t *testing.T) {
	t.Run("no items is an empty array, not null", func(t *testing.T) {
		rec := itemRequest(t, &fakeItems{}, http.MethodGet, listItemsPathFor(), "")

		if got := strings.TrimSpace(rec.Body.String()); rec.Code != http.StatusOK || got != `{"items":[]}` {
			t.Errorf("status = %d, body = %s", rec.Code, got)
		}
	})

	t.Run("items of the list", func(t *testing.T) {
		items := &fakeItems{items: []item.Item{testItem()}}

		rec := itemRequest(t, items, http.MethodGet, listItemsPathFor(), "")

		var got apigen.ItemList
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode body %s: %v", rec.Body, err)
		}
		if len(got.Items) != 1 || got.Items[0].Name != "Mehl" {
			t.Errorf("items = %+v", got.Items)
		}
		requireUTCTimestamps(t, rec.Body.Bytes())
		if want := fmt.Sprintf("ListForList %s %s", testUserID, testListID); len(items.calls) != 1 || items.calls[0] != want {
			t.Errorf("calls = %q, want [%q]", items.calls, want)
		}
	})
}

func TestListGroupItems(t *testing.T) {
	t.Run("no lists and no items are empty arrays, not null", func(t *testing.T) {
		rec := itemRequest(t, &fakeItems{}, http.MethodGet, groupItemsPathFor(), "")

		if got := strings.TrimSpace(rec.Body.String()); rec.Code != http.StatusOK || got != `{"items":[],"listIds":[]}` {
			t.Errorf("status = %d, body = %s", rec.Code, got)
		}
	})

	t.Run("a list without items is named, with empty items", func(t *testing.T) {
		items := &fakeItems{group: item.GroupItems{ListIDs: []uuid.UUID{testListID}}}

		rec := itemRequest(t, items, http.MethodGet, groupItemsPathFor(), "")

		want := fmt.Sprintf(`{"items":[],"listIds":[%q]}`, testListID)
		if got := strings.TrimSpace(rec.Body.String()); rec.Code != http.StatusOK || got != want {
			t.Errorf("status = %d, body = %s, want %s", rec.Code, got, want)
		}
	})

	t.Run("lists and items of the group", func(t *testing.T) {
		otherListID := uuid.New()
		items := &fakeItems{group: item.GroupItems{
			ListIDs: []uuid.UUID{testListID, otherListID},
			Items:   []item.Item{testItem()},
		}}

		rec := itemRequest(t, items, http.MethodGet, groupItemsPathFor(), "")

		var got apigen.GroupItemList
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode body %s: %v", rec.Body, err)
		}
		if len(got.ListIds) != 2 || got.ListIds[0] != testListID || got.ListIds[1] != otherListID {
			t.Errorf("listIds = %v, want [%s %s]", got.ListIds, testListID, otherListID)
		}
		if len(got.Items) != 1 || got.Items[0].Name != "Mehl" {
			t.Errorf("items = %+v", got.Items)
		}
		requireUTCTimestamps(t, rec.Body.Bytes())
		if want := fmt.Sprintf("ListForGroup %s %s", testUserID, testGroupID); len(items.calls) != 1 || items.calls[0] != want {
			t.Errorf("calls = %q, want [%q]", items.calls, want)
		}
	})

	t.Run("a malformed group ID is a bad request", func(t *testing.T) {
		items := &fakeItems{}

		rec := itemRequest(t, items, http.MethodGet, "/api/v1/groups/not-a-uuid/items", "")

		if rec.Code != http.StatusBadRequest || len(items.calls) != 0 {
			t.Errorf("status = %d, calls = %q; want 400 and no call", rec.Code, items.calls)
		}
	})
}

func TestCreateItem(t *testing.T) {
	t.Run("passes every field and the ID of the client on", func(t *testing.T) {
		items := &fakeItems{items: []item.Item{testItem()}}
		body := `{"id":"` + testItemID.String() + `","name":"Mehl","quantity":0.5,"unit":"kg","note":"Typ 405"}`

		rec := itemRequest(t, items, http.MethodPost, listItemsPathFor(), body)

		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
		n := items.created
		if n.ID != testItemID || n.Name != "Mehl" || n.Quantity == nil || *n.Quantity != 0.5 ||
			n.Unit == nil || *n.Unit != item.UnitKilogram || n.Note == nil || *n.Note != "Typ 405" {
			t.Errorf("NewItem = %+v", n)
		}
	})

	t.Run("without an ID the server picks one", func(t *testing.T) {
		items := &fakeItems{items: []item.Item{testItem()}}

		itemRequest(t, items, http.MethodPost, listItemsPathFor(), `{"name":"Mehl"}`)

		id := items.created.ID
		if id == uuid.Nil || id.Version() != 7 {
			t.Errorf("ID = %s, want a UUIDv7", id)
		}
		if items.created.Quantity != nil || items.created.Unit != nil || items.created.Note != nil {
			t.Errorf("NewItem = %+v, want no quantity, unit or note", items.created)
		}
	})

	t.Run("two requests get different IDs", func(t *testing.T) {
		items := &fakeItems{items: []item.Item{testItem()}}
		itemRequest(t, items, http.MethodPost, listItemsPathFor(), `{"name":"A"}`)
		first := items.created.ID
		itemRequest(t, items, http.MethodPost, listItemsPathFor(), `{"name":"B"}`)
		if first == items.created.ID {
			t.Errorf("both requests got ID %s", first)
		}
	})

	t.Run("the ID of a deleted item is taken", func(t *testing.T) {
		deleted := testItem()
		deletedAt := itemTime
		deleted.DeletedAt = &deletedAt

		rec := itemRequest(t, &fakeItems{items: []item.Item{deleted}}, http.MethodPost, listItemsPathFor(), `{"id":"`+testItemID.String()+`","name":"Mehl"}`)

		if rec.Code != http.StatusConflict || strings.TrimSpace(rec.Body.String()) != errorBody("ITEM_ID_TAKEN") {
			t.Errorf("status = %d, body = %s, want 409 ITEM_ID_TAKEN", rec.Code, rec.Body)
		}
	})
}

// TestUpdateItemChange checks how the three states of a field in the body
// reach the service: left out, null and a value.
func TestUpdateItemChange(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{"name", `{"name":"Hafermilch"}`, "name=Hafermilch"},
		{"quantity value", `{"quantity":2.5}`, "quantity=2.5"},
		{"quantity null removes it", `{"quantity":null}`, "quantity=null"},
		{"unit value", `{"unit":"ml"}`, "unit=ml"},
		{"unit null removes it", `{"unit":null}`, "unit=null"},
		{"unknown unit reaches the service, which refuses it", `{"unit":"cup"}`, "unit=cup"},
		{"note value", `{"note":"bio"}`, "note=bio"},
		{"note null removes it", `{"note":null}`, "note=null"},
		{"checked", `{"checked":true}`, "checked=true"},
		{"unchecked", `{"checked":false}`, "checked=false"},
		{"several fields", `{"name":"A","quantity":null,"checked":false}`, "name=A quantity=null checked=false"},
		{"fields that are left out are not touched", `{"note":"x"}`, "note=x"},
		{"nothing at all", `{}`, ""},
		{"unknown fields are ignored", `{"price":3,"name":"A"}`, "name=A"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items := &fakeItems{items: []item.Item{testItem()}}

			rec := itemRequest(t, items, http.MethodPatch, itemPathFor(), tt.body)

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
			}
			want := fmt.Sprintf("Update %s %s %s [%s]", testUserID, testItemID, testItemClock, tt.want)
			if len(items.calls) != 1 || items.calls[0] != want {
				t.Errorf("calls = %q, want [%q]", items.calls, want)
			}
		})
	}
}

// TestItemClockFromClient checks which clock a change reaches the service
// with: the one the client sent, or the server's if it sent none.
func TestItemClockFromClient(t *testing.T) {
	const sent = "0000019a2b3c4d5f-0003-phone_1"

	routes := []struct {
		name   string
		method string
		path   string
		// body is the request without a clock; the cases add one.
		body string
		// call is the expected service call with %s for the clock.
		call string
	}{
		{"create", http.MethodPost, listItemsPathFor(), `"name":"Mehl"`, "Create " + testUserID.String() + " " + testListID.String() + " %s"},
		{"update", http.MethodPatch, itemPathFor(), `"checked":true`, "Update " + testUserID.String() + " " + testItemID.String() + " %s [checked=true]"},
	}
	cases := []struct {
		name  string
		clock string
		want  item.HLC
	}{
		{"the clock of the client", `,"clock":"` + sent + `"`, sent},
		{"without a clock the server stamps it", "", testItemClock},
		{"null counts as no clock", `,"clock":null`, testItemClock},
	}

	for _, route := range routes {
		for _, tc := range cases {
			t.Run(route.name+": "+tc.name, func(t *testing.T) {
				items := &fakeItems{items: []item.Item{testItem()}}

				rec := itemRequest(t, items, route.method, route.path, "{"+route.body+tc.clock+"}")

				if rec.Code >= 300 {
					t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
				}
				if want := fmt.Sprintf(route.call, tc.want); len(items.calls) != 1 || items.calls[0] != want {
					t.Errorf("calls = %q, want [%q]", items.calls, want)
				}
			})
		}

		for _, bad := range []string{`""`, `"yesterday"`, `"0000019A2B3C4D5F-0003-phone"`, `42`} {
			t.Run(route.name+": invalid clock "+bad, func(t *testing.T) {
				items := &fakeItems{items: []item.Item{testItem()}}

				rec := itemRequest(t, items, route.method, route.path, "{"+route.body+`,"clock":`+bad+"}")

				if rec.Code != http.StatusBadRequest || strings.TrimSpace(rec.Body.String()) != errorBody("INVALID_REQUEST") {
					t.Errorf("status = %d, body = %s, want 400 INVALID_REQUEST", rec.Code, rec.Body)
				}
				if len(items.calls) != 0 {
					t.Errorf("calls = %q, want none", items.calls)
				}
			})
		}
	}
}

func TestDeletedItemsAreGone(t *testing.T) {
	deleted := testItem()
	deletedAt := itemTime
	deleted.DeletedAt = &deletedAt

	routes := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"get", http.MethodGet, itemPathFor(), ""},
		{"update", http.MethodPatch, itemPathFor(), `{"name":"Zombie"}`},
	}
	for _, route := range routes {
		t.Run(route.name, func(t *testing.T) {
			rec := itemRequest(t, &fakeItems{items: []item.Item{deleted}}, route.method, route.path, route.body)

			if rec.Code != http.StatusNotFound || strings.TrimSpace(rec.Body.String()) != errorBody("ITEM_NOT_FOUND") {
				t.Errorf("status = %d, body = %s, want 404 ITEM_NOT_FOUND", rec.Code, rec.Body)
			}
		})
	}

	t.Run("delete answers 204, also for a deleted item", func(t *testing.T) {
		items := &fakeItems{items: []item.Item{deleted}}

		rec := itemRequest(t, items, http.MethodDelete, itemPathFor(), "")

		if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
			t.Errorf("status = %d, body = %q; want 204 and no body", rec.Code, rec.Body)
		}
		if want := fmt.Sprintf("Delete %s %s", testUserID, testItemID); len(items.calls) != 1 || items.calls[0] != want {
			t.Errorf("calls = %q, want [%q]", items.calls, want)
		}
	})
}

// TestItemErrors checks the mapping of domain errors on every route; the
// mapping itself is shared by all handlers.
func TestItemErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"not found", fmt.Errorf("get item: %w", item.ErrNotFound), http.StatusNotFound, "ITEM_NOT_FOUND"},
		{"id taken", item.ErrIDTaken, http.StatusConflict, "ITEM_ID_TAKEN"},
		{"invalid name", fmt.Errorf("%w: name is empty", item.ErrInvalidName), http.StatusBadRequest, "ITEM_NAME_INVALID"},
		{"invalid quantity", item.ErrInvalidQuantity, http.StatusBadRequest, "ITEM_QUANTITY_INVALID"},
		{"invalid unit", item.ErrInvalidUnit, http.StatusBadRequest, "ITEM_UNIT_INVALID"},
		{"invalid note", item.ErrInvalidNote, http.StatusBadRequest, "ITEM_NOTE_INVALID"},
		{"invalid id", item.ErrInvalidID, http.StatusBadRequest, "INVALID_REQUEST"},
		{"empty change", item.ErrEmptyChange, http.StatusBadRequest, "INVALID_REQUEST"},
		{"too many items", item.ErrTooManyItems, http.StatusBadRequest, "INVALID_REQUEST"},
		{"group not found", item.ErrGroupNotFound, http.StatusNotFound, "GROUP_NOT_FOUND"},
		{"database failure", errors.New("connection refused"), http.StatusInternalServerError, "INTERNAL_ERROR"},
	}
	routes := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"list", http.MethodGet, listItemsPathFor(), ""},
		{"list group", http.MethodGet, groupItemsPathFor(), ""},
		{"create", http.MethodPost, listItemsPathFor(), `{"name":"x"}`},
		{"get", http.MethodGet, itemPathFor(), ""},
		{"update", http.MethodPatch, itemPathFor(), `{"name":"x"}`},
		{"delete", http.MethodDelete, itemPathFor(), ""},
		{"remove checked", http.MethodPost, removeCheckedPathFor(), `{"itemIds":[]}`},
	}

	for _, route := range routes {
		for _, tt := range tests {
			t.Run(route.name+": "+tt.name, func(t *testing.T) {
				rec := itemRequest(t, &fakeItems{err: tt.err}, route.method, route.path, route.body)

				if rec.Code != tt.wantStatus {
					t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
				}
				if got := strings.TrimSpace(rec.Body.String()); got != errorBody(tt.wantCode) {
					t.Errorf("body = %s, want %s", got, errorBody(tt.wantCode))
				}
			})
		}
	}
}

func TestItemBadRequests(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"list ID is no UUID", http.MethodGet, "/api/v1/lists/nope/items", ""},
		{"item ID is no UUID", http.MethodGet, "/api/v1/items/nope", ""},
		{"item ID is no UUID when deleting", http.MethodDelete, "/api/v1/items/nope", ""},
		{"create without JSON", http.MethodPost, listItemsPathFor(), "name=x"},
		{"create without body", http.MethodPost, listItemsPathFor(), ""},
		{"create with an ID that is no UUID", http.MethodPost, listItemsPathFor(), `{"id":"nope","name":"x"}`},
		{"create with a quantity that is no number", http.MethodPost, listItemsPathFor(), `{"name":"x","quantity":"viel"}`},
		{"update with broken JSON", http.MethodPatch, itemPathFor(), `{"name":`},
		{"update with a name that is no string", http.MethodPatch, itemPathFor(), `{"name":5}`},
		{"update with a quantity that is no number", http.MethodPatch, itemPathFor(), `{"quantity":"viel"}`},
		{"update with checked that is no boolean", http.MethodPatch, itemPathFor(), `{"checked":"yes"}`},
		// Neither can be removed, so null is an invalid request, not a change.
		{"update with name null", http.MethodPatch, itemPathFor(), `{"name":null}`},
		{"update with checked null", http.MethodPatch, itemPathFor(), `{"checked":null}`},
		{"update with oversized body", http.MethodPatch, itemPathFor(), `{"note":"` + strings.Repeat("a", maxGroupBodyBytes) + `"}`},
		{"remove checked with list ID that is no UUID", http.MethodPost, "/api/v1/lists/nope/items/remove-checked", `{"itemIds":[]}`},
		// itemIds is required; an empty array is fine, a missing one is not.
		{"remove checked without itemIds", http.MethodPost, removeCheckedPathFor(), `{}`},
		{"remove checked with itemIds null", http.MethodPost, removeCheckedPathFor(), `{"itemIds":null}`},
		{"remove checked with an ID that is no UUID", http.MethodPost, removeCheckedPathFor(), `{"itemIds":["nope"]}`},
		{"remove checked without body", http.MethodPost, removeCheckedPathFor(), ""},
		{"remove checked with oversized body", http.MethodPost, removeCheckedPathFor(), `{"itemIds":[],"x":"` + strings.Repeat("a", maxRemoveCheckedBodyBytes) + `"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			items := &fakeItems{}

			rec := itemRequest(t, items, tt.method, tt.path, tt.body)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != errorBody("INVALID_REQUEST") {
				t.Errorf("body = %s", got)
			}
			if len(items.calls) != 0 {
				t.Errorf("service was called: %q", items.calls)
			}
		})
	}
}

func TestItemRoutesNeedLogin(t *testing.T) {
	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, listItemsPathFor()},
		{http.MethodPost, listItemsPathFor()},
		{http.MethodGet, itemPathFor()},
		{http.MethodPatch, itemPathFor()},
		{http.MethodDelete, itemPathFor()},
		{http.MethodPost, removeCheckedPathFor()},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			items := &fakeItems{}
			router := NewRouter(Deps{
				Env:       config.EnvDevelopment,
				DB:        fakePinger{},
				Sessions:  &fakeSessions{fakeValidator: fakeValidator{validToken: groupToken}},
				Users:     &fakeUsers{},
				Items:     items,
				ItemClock: fakeItemClock{},
			})
			// No session cookie.
			req := httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`))
			rec := httptest.NewRecorder()

			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", rec.Code)
			}
			if len(items.calls) != 0 {
				t.Errorf("service was called: %q", items.calls)
			}
		})
	}
}

func TestItemWrongMethod(t *testing.T) {
	tests := []struct {
		path      string
		method    string
		wantAllow string
	}{
		{listItemsPathFor(), http.MethodDelete, "GET, POST"},
		{itemPathFor(), http.MethodPost, "GET, PATCH, DELETE"},
		{removeCheckedPathFor(), http.MethodGet, "POST"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := itemRequest(t, &fakeItems{}, tt.method, tt.path, "")

			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("status = %d, want 405", rec.Code)
			}
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", got, tt.wantAllow)
			}
		})
	}
}
