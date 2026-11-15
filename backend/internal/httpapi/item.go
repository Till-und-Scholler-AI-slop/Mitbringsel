package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/item"
)

const (
	listItemsPath     = listPath + "/items"
	removeCheckedPath = listItemsPath + "/remove-checked"
	itemPath          = "/api/v1/items/{itemId}"
	groupItemsPath    = groupPath + "/items"

	// maxRemoveCheckedBodyBytes leaves room for item.MaxRemoveItems IDs: one
	// is 39 bytes in JSON (36 characters, the quotes and a comma), 500 of
	// them about 19 KiB, plus whitespace a client may add.
	maxRemoveCheckedBodyBytes = 32 << 10 // 32 KiB
)

// ItemService is everything the handlers need from items.
// *item.Service satisfies it; tests use a fake.
type ItemService interface {
	Create(ctx context.Context, actor, listID uuid.UUID, n item.NewItem, clock item.HLC) (item.Item, error)
	ListForList(ctx context.Context, actor, listID uuid.UUID) ([]item.Item, error)
	ListForGroup(ctx context.Context, actor, groupID uuid.UUID) ([]item.Item, error)
	Get(ctx context.Context, actor, itemID uuid.UUID) (item.Item, error)
	Update(ctx context.Context, actor, itemID uuid.UUID, change item.Change, clock item.HLC) (item.Item, error)
	Delete(ctx context.Context, actor, itemID uuid.UUID) (item.Item, error)
	RemoveChecked(ctx context.Context, actor, listID uuid.UUID, itemIDs []uuid.UUID) ([]item.Item, error)
}

// ItemClock issues the clocks for changes made over REST that bring no
// clock of their own. *item.Clock satisfies it; tests use a fake.
type ItemClock interface {
	Next() item.HLC
}

// clockFor returns the clock a change is stamped with: the one the client
// sent, or a new one from the server if it sent none (older clients). It
// returns false if the sent clock is not a valid HLC. A clock too far ahead
// is limited later by item.Merge, not here.
func clockFor(sent *string, clock ItemClock) (item.HLC, bool) {
	if sent == nil {
		return clock.Next(), true
	}
	hlc, err := item.ParseHLC(*sent)
	if err != nil {
		return "", false
	}
	return hlc, true
}

// newItemResponse translates the domain item into the Item schema of the API
// contract. Timestamps are converted to UTC (see utcPtr).
func newItemResponse(i item.Item) apigen.Item {
	var unit *apigen.Unit
	if i.Unit != nil {
		u := apigen.Unit(*i.Unit)
		unit = &u
	}
	return apigen.Item{
		ID:        i.ID,
		ListID:    i.ListID,
		Name:      i.Name,
		Quantity:  i.Quantity,
		Unit:      unit,
		Note:      i.Note,
		Checked:   i.Checked,
		CheckedBy: i.CheckedBy,
		CheckedAt: utcPtr(i.CheckedAt),
		CreatedBy: i.CreatedBy,
		CreatedAt: i.CreatedAt.UTC(),
		ServerSeq: i.ServerSeq,
		Clocks: apigen.ItemClocks{
			Name:     string(i.Clocks[item.FieldName]),
			Quantity: string(i.Clocks[item.FieldQuantity]),
			Unit:     string(i.Clocks[item.FieldUnit]),
			Note:     string(i.Clocks[item.FieldNote]),
			Checked:  string(i.Clocks[item.FieldChecked]),
		},
	}
}

// listItemsHandler returns the items of one list.
func listItemsHandler(items ItemService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, listID, ok := actorAndListFrom(w, r)
		if !ok {
			return
		}

		found, err := items.ListForList(r.Context(), actor, listID)
		if err != nil {
			writeItemError(w, "list items", err)
			return
		}

		// make instead of a nil slice, so "no items" is [] and not null.
		resp := apigen.ItemList{Items: make([]apigen.Item, len(found))}
		for i, it := range found {
			resp.Items[i] = newItemResponse(it)
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

func groupItemsHandler(items ItemService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, groupID, ok := actorAndGroupFrom(w, r)
		if !ok {
			return
		}

		found, err := items.ListForGroup(r.Context(), actor, groupID)
		if err != nil {
			writeItemError(w, "list group items", err)
			return
		}

		resp := apigen.ItemList{Items: make([]apigen.Item, len(found))}
		for i, it := range found {
			resp.Items[i] = newItemResponse(it)
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

func createItemHandler(items ItemService, clock ItemClock) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, listID, ok := actorAndListFrom(w, r)
		if !ok {
			return
		}
		var req apigen.CreateItemRequest
		if !decodeBody(w, r, &req) {
			return
		}

		var id uuid.UUID
		if req.ID != nil {
			id = *req.ID
		} else {
			// UUIDv7 like the IDs of the database: sorted by creation time.
			var err error
			if id, err = uuid.NewV7(); err != nil {
				slog.Error("items: new item id", "error", err)
				writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
				return
			}
		}
		n := item.NewItem{ID: id, Name: req.Name, Quantity: req.Quantity, Note: req.Note}
		if req.Unit != nil {
			u := item.Unit(*req.Unit)
			n.Unit = &u
		}

		stamp, valid := clockFor(req.Clock, clock)
		if !valid {
			writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
			return
		}

		created, err := items.Create(r.Context(), actor, listID, n, stamp)
		if err != nil {
			writeItemError(w, "create item", err)
			return
		}
		// An ID of a deleted item cannot be used again.
		if created.Deleted() {
			writeError(w, http.StatusConflict, apigen.ErrorCodeItemIDTaken)
			return
		}
		writeJSON(w, http.StatusCreated, newItemResponse(created))
	}
}

func getItemHandler(items ItemService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, itemID, ok := actorAndItemFrom(w, r)
		if !ok {
			return
		}

		it, err := items.Get(r.Context(), actor, itemID)
		if err != nil {
			writeItemError(w, "get item", err)
			return
		}
		// A deleted item is gone for the users.
		if it.Deleted() {
			writeError(w, http.StatusNotFound, apigen.ErrorCodeItemNotFound)
			return
		}
		writeJSON(w, http.StatusOK, newItemResponse(it))
	}
}

// optionalField is a field of a JSON body that tells apart "left out" (set
// is false), "null" (set, value nil) and "has a value". A plain pointer
// cannot: it is nil for both a missing field and null, but a PATCH has to
// know whether to keep a quantity or remove it.
type optionalField[T any] struct {
	set   bool
	value *T
}

// UnmarshalJSON is only called for fields that are present in the body, null
// included, which is what makes set work.
func (o *optionalField[T]) UnmarshalJSON(data []byte) error {
	o.set = true
	if string(data) == "null" {
		o.value = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	o.value = &v
	return nil
}

// updateItemRequest is the body of PATCH /items/{itemId} (UpdateItemRequest
// in the contract).
type updateItemRequest struct {
	Name     optionalField[string]  `json:"name"`
	Quantity optionalField[float64] `json:"quantity"`
	Unit     optionalField[string]  `json:"unit"`
	Note     optionalField[string]  `json:"note"`
	Checked  optionalField[bool]    `json:"checked"`
	// Clock is a pointer: nil if the client sent none (or null).
	Clock *string `json:"clock"`
}

// change translates the body into a domain change. It returns false if a
// field that cannot be null is null.
func (req updateItemRequest) change() (item.Change, bool) {
	var c item.Change
	if req.Name.set {
		if req.Name.value == nil {
			return item.Change{}, false
		}
		c.Name = item.Some(*req.Name.value)
	}
	if req.Quantity.set {
		c.Quantity = item.Some(req.Quantity.value)
	}
	if req.Unit.set {
		var unit *item.Unit
		if req.Unit.value != nil {
			u := item.Unit(*req.Unit.value)
			unit = &u
		}
		c.Unit = item.Some(unit)
	}
	if req.Note.set {
		c.Note = item.Some(req.Note.value)
	}
	if req.Checked.set {
		if req.Checked.value == nil {
			return item.Change{}, false
		}
		c.Checked = item.Some(*req.Checked.value)
	}
	return c, true
}

func updateItemHandler(items ItemService, clock ItemClock) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, itemID, ok := actorAndItemFrom(w, r)
		if !ok {
			return
		}
		var req updateItemRequest
		if !decodeBody(w, r, &req) {
			return
		}
		change, valid := req.change()
		if !valid {
			writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
			return
		}
		stamp, valid := clockFor(req.Clock, clock)
		if !valid {
			writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
			return
		}

		it, err := items.Update(r.Context(), actor, itemID, change, stamp)
		if err != nil {
			writeItemError(w, "update item", err)
			return
		}
		// Changing a deleted item does nothing; for the users it is gone.
		if it.Deleted() {
			writeError(w, http.StatusNotFound, apigen.ErrorCodeItemNotFound)
			return
		}
		writeJSON(w, http.StatusOK, newItemResponse(it))
	}
}

func deleteItemHandler(items ItemService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, itemID, ok := actorAndItemFrom(w, r)
		if !ok {
			return
		}

		if _, err := items.Delete(r.Context(), actor, itemID); err != nil {
			writeItemError(w, "delete item", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// removeCheckedItemsHandler deletes the checked items the client names and
// answers which ones it deleted.
func removeCheckedItemsHandler(items ItemService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, listID, ok := actorAndListFrom(w, r)
		if !ok {
			return
		}
		var req apigen.RemoveCheckedItemsRequest
		if !decodeBodyMax(w, r, &req, maxRemoveCheckedBodyBytes) {
			return
		}
		// itemIds is required: a missing field or null decodes to nil, an
		// empty array to an empty slice.
		if req.ItemIds == nil {
			writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
			return
		}

		deleted, err := items.RemoveChecked(r.Context(), actor, listID, req.ItemIds)
		if err != nil {
			writeItemError(w, "remove checked items", err)
			return
		}

		resp := apigen.RemovedItems{Items: make([]apigen.DeletedItem, len(deleted))}
		for i, it := range deleted {
			resp.Items[i] = apigen.DeletedItem{ItemID: it.ID, ServerSeq: it.ServerSeq}
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// actorAndItemFrom returns the logged-in user and the item ID from the path.
// On failure it has answered already and returns false.
func actorAndItemFrom(w http.ResponseWriter, r *http.Request) (actor, itemID uuid.UUID, ok bool) {
	actor, ok = actorFrom(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	itemID, ok = pathUUID(w, r, "itemId")
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	return actor, itemID, true
}

// writeItemError maps a domain error to its status and error code. Errors it
// does not know are logged and answered with 500.
func writeItemError(w http.ResponseWriter, op string, err error) {
	switch {
	case errors.Is(err, item.ErrNotFound):
		writeError(w, http.StatusNotFound, apigen.ErrorCodeItemNotFound)
	case errors.Is(err, item.ErrGroupNotFound):
		writeError(w, http.StatusNotFound, apigen.ErrorCodeGroupNotFound)
	case errors.Is(err, item.ErrIDTaken):
		writeError(w, http.StatusConflict, apigen.ErrorCodeItemIDTaken)
	case errors.Is(err, item.ErrInvalidName):
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeItemNameInvalid)
	case errors.Is(err, item.ErrInvalidQuantity):
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeItemQuantityInvalid)
	case errors.Is(err, item.ErrInvalidUnit):
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeItemUnitInvalid)
	case errors.Is(err, item.ErrInvalidNote):
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeItemNoteInvalid)
	case errors.Is(err, item.ErrInvalidID), errors.Is(err, item.ErrEmptyChange), errors.Is(err, item.ErrTooManyItems):
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
	default:
		slog.Error("items: "+op, "error", err)
		writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
	}
}
