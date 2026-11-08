package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/list"
)

const (
	groupListsPath   = groupPath + "/lists"
	listPath         = "/api/v1/lists/{listId}"
	listArchivedPath = listPath + "/archived"
)

// ListService is everything the handlers need from lists.
// *list.Service satisfies it; tests use a fake.
type ListService interface {
	Create(ctx context.Context, actor, groupID uuid.UUID, name string) (list.List, error)
	ListForGroup(ctx context.Context, actor, groupID uuid.UUID, includeArchived bool) ([]list.List, error)
	Get(ctx context.Context, actor, listID uuid.UUID) (list.List, error)
	Rename(ctx context.Context, actor, listID uuid.UUID, name string) (list.List, error)
	Archive(ctx context.Context, actor, listID uuid.UUID) (list.List, error)
	Unarchive(ctx context.Context, actor, listID uuid.UUID) (list.List, error)
	Delete(ctx context.Context, actor, listID uuid.UUID) error
}

// newListResponse translates the domain list into the List schema of the
// API contract. Timestamps are converted to UTC: pgx reads them in the local
// zone of the server, which would put that offset into the JSON.
func newListResponse(l list.List) apigen.List {
	return apigen.List{
		ID:         l.ID,
		GroupID:    l.GroupID,
		Name:       l.Name,
		ArchivedAt: utcPtr(l.ArchivedAt),
		CreatedAt:  l.CreatedAt.UTC(),
		UpdatedAt:  l.UpdatedAt.UTC(),
		ServerSeq:  l.ServerSeq,
	}
}

// listListsHandler returns the lists of one group. Archived lists only come
// along with ?includeArchived=true.
func listListsHandler(lists ListService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, groupID, ok := actorAndGroupFrom(w, r)
		if !ok {
			return
		}
		// Strict on purpose: strconv.ParseBool would also take "1" and "T",
		// but the contract only promises true and false.
		includeArchived := false
		switch r.URL.Query().Get("includeArchived") {
		case "", "false":
		case "true":
			includeArchived = true
		default:
			writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
			return
		}

		found, err := lists.ListForGroup(r.Context(), actor, groupID, includeArchived)
		if err != nil {
			writeListError(w, "list lists", err)
			return
		}

		// make instead of a nil slice, so "no lists" is [] and not null.
		resp := apigen.ListList{Lists: make([]apigen.List, len(found))}
		for i, l := range found {
			resp.Lists[i] = newListResponse(l)
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

func createListHandler(lists ListService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, groupID, ok := actorAndGroupFrom(w, r)
		if !ok {
			return
		}
		var req apigen.ListNameRequest
		if !decodeBody(w, r, &req) {
			return
		}

		l, err := lists.Create(r.Context(), actor, groupID, req.Name)
		if err != nil {
			writeListError(w, "create list", err)
			return
		}
		writeJSON(w, http.StatusCreated, newListResponse(l))
	}
}

func getListHandler(lists ListService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, listID, ok := actorAndListFrom(w, r)
		if !ok {
			return
		}

		l, err := lists.Get(r.Context(), actor, listID)
		if err != nil {
			writeListError(w, "get list", err)
			return
		}
		writeJSON(w, http.StatusOK, newListResponse(l))
	}
}

func updateListHandler(lists ListService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, listID, ok := actorAndListFrom(w, r)
		if !ok {
			return
		}
		var req apigen.ListNameRequest
		if !decodeBody(w, r, &req) {
			return
		}

		l, err := lists.Rename(r.Context(), actor, listID, req.Name)
		if err != nil {
			writeListError(w, "rename list", err)
			return
		}
		writeJSON(w, http.StatusOK, newListResponse(l))
	}
}

func setListArchivedHandler(lists ListService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, listID, ok := actorAndListFrom(w, r)
		if !ok {
			return
		}
		// A pointer tells "false" from "missing": with a plain bool a body
		// without the field would silently unarchive the list.
		var req struct {
			Archived *bool `json:"archived"`
		}
		if !decodeBody(w, r, &req) {
			return
		}
		if req.Archived == nil {
			writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
			return
		}

		var (
			l   list.List
			err error
		)
		if *req.Archived {
			l, err = lists.Archive(r.Context(), actor, listID)
		} else {
			l, err = lists.Unarchive(r.Context(), actor, listID)
		}
		if err != nil {
			writeListError(w, "set list archived", err)
			return
		}
		writeJSON(w, http.StatusOK, newListResponse(l))
	}
}

func deleteListHandler(lists ListService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, listID, ok := actorAndListFrom(w, r)
		if !ok {
			return
		}

		if err := lists.Delete(r.Context(), actor, listID); err != nil {
			writeListError(w, "delete list", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// actorAndListFrom returns the logged-in user and the list ID from the
// path. On failure it has answered already and returns false.
func actorAndListFrom(w http.ResponseWriter, r *http.Request) (actor, listID uuid.UUID, ok bool) {
	actor, ok = actorFrom(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	listID, ok = pathUUID(w, r, "listId")
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	return actor, listID, true
}

// writeListError maps a domain error to its status and error code. Errors
// it does not know are logged and answered with 500.
func writeListError(w http.ResponseWriter, op string, err error) {
	switch {
	case errors.Is(err, list.ErrNotFound):
		writeError(w, http.StatusNotFound, apigen.ErrorCodeListNotFound)
	case errors.Is(err, list.ErrForbidden):
		writeError(w, http.StatusForbidden, apigen.ErrorCodeForbidden)
	case errors.Is(err, list.ErrInvalidName):
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeListNameInvalid)
	default:
		slog.Error("lists: "+op, "error", err)
		writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
	}
}
