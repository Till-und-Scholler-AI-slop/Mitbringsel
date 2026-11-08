package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"mitbringsel/internal/group"
	"mitbringsel/internal/httpapi/apigen"
)

const (
	groupsPath = "/api/v1/groups"
	// {groupId} is a wildcard: the router hands the matching part of the
	// URL to the handler, which reads it with r.PathValue(groupIDParam).
	groupPath    = groupsPath + "/{groupId}"
	groupIDParam = "groupId"

	// A group name is at most 100 characters; anything much larger is not a
	// request for a group.
	maxGroupBodyBytes = 4 << 10 // 4 KiB
)

// GroupService is everything the handlers need from groups. *group.Service
// satisfies it; tests use a fake. Every method takes the acting user, and
// the service decides what they may do.
type GroupService interface {
	List(ctx context.Context, actor uuid.UUID) ([]group.Details, error)
	Get(ctx context.Context, actor, groupID uuid.UUID) (group.Details, error)
	Create(ctx context.Context, actor uuid.UUID, name string) (group.Details, error)
}

// newGroupResponse translates the domain group into the Group schema of the
// API contract (see newMeResponse for why).
func newGroupResponse(d group.Details) apigen.Group {
	// make with a length, not a nil slice: nil would be written as null, but
	// the contract promises an array.
	members := make([]apigen.GroupMember, len(d.Members))
	for i, m := range d.Members {
		members[i] = apigen.GroupMember{
			UserID:      m.UserID,
			DisplayName: m.DisplayName,
			Role:        apigen.GroupRole(m.Role),
			JoinedAt:    m.JoinedAt,
		}
		if m.AvatarURL != "" {
			// m is a copy per loop pass, so its address is safe to keep.
			members[i].AvatarURL = &m.AvatarURL
		}
	}
	return apigen.Group{
		ID:        d.ID,
		Name:      d.Name,
		Role:      apigen.GroupRole(d.Role),
		Members:   members,
		CreatedAt: d.CreatedAt,
		UpdatedAt: d.UpdatedAt,
	}
}

// writeGroupError answers with the status and code that belong to a domain
// error. This is the one place that decides it, so every group endpoint
// treats the same error the same way. Errors that are not domain errors are
// our fault: they are logged (operation says where) and answered with 500.
func writeGroupError(w http.ResponseWriter, operation string, err error) {
	// errors.Is looks through the "...: %w" wrapping the service adds, which
	// a plain == comparison would not.
	switch {
	case errors.Is(err, group.ErrNotFound):
		writeError(w, http.StatusNotFound, apigen.ErrorCodeNotFound)
	case errors.Is(err, group.ErrForbidden):
		writeError(w, http.StatusForbidden, apigen.ErrorCodeGroupOwnerRequired)
	case errors.Is(err, group.ErrInvalidName):
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeGroupNameInvalid)
	case errors.Is(err, group.ErrInvalidRole):
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
	case errors.Is(err, group.ErrLastOwner):
		writeError(w, http.StatusConflict, apigen.ErrorCodeLastOwner)
	default:
		slog.Error(operation, "error", err)
		writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
	}
}

// actorID returns the logged-in user. Without one the route is missing
// requireUser, a bug of ours: it answers 500 itself and returns false.
func actorID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	userID, ok := userIDFrom(r.Context())
	if !ok {
		slog.Error("groups: no user in request context, route is missing requireUser")
		writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
		return uuid.Nil, false
	}
	return userID, true
}

// groupIDFromPath reads {groupId} from the URL. A value that is no UUID
// cannot belong to a group, so it answers 404 like an unknown group and
// returns false.
func groupIDFromPath(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue(groupIDParam))
	if err != nil {
		writeError(w, http.StatusNotFound, apigen.ErrorCodeNotFound)
		return uuid.Nil, false
	}
	return id, true
}

// listGroupsHandler returns the groups of the logged-in user. It must run
// behind requireUser.
func listGroupsHandler(groups GroupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := actorID(w, r)
		if !ok {
			return
		}

		list, err := groups.List(r.Context(), actor)
		if err != nil {
			writeGroupError(w, "list groups", err)
			return
		}

		resp := make([]apigen.Group, len(list))
		for i, d := range list {
			resp[i] = newGroupResponse(d)
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

// getGroupHandler returns one group. It must run behind requireUser.
func getGroupHandler(groups GroupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := actorID(w, r)
		if !ok {
			return
		}
		groupID, ok := groupIDFromPath(w, r)
		if !ok {
			return
		}

		d, err := groups.Get(r.Context(), actor, groupID)
		if err != nil {
			writeGroupError(w, "get group", err)
			return
		}
		writeJSON(w, http.StatusOK, newGroupResponse(d))
	}
}

// createGroupHandler creates a group with the logged-in user as its owner.
// It must run behind requireUser.
func createGroupHandler(groups GroupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := actorID(w, r)
		if !ok {
			return
		}
		var req apigen.GroupNameRequest
		if !decodeJSON(w, r, maxGroupBodyBytes, &req) {
			return
		}

		d, err := groups.Create(r.Context(), actor, req.Name)
		if err != nil {
			writeGroupError(w, "create group", err)
			return
		}
		writeJSON(w, http.StatusCreated, newGroupResponse(d))
	}
}
