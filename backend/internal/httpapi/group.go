package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"mitbringsel/internal/group"
	"mitbringsel/internal/httpapi/apigen"
)

const (
	groupsPath     = "/api/v1/groups"
	groupPath      = groupsPath + "/{groupId}"
	memberPath     = groupPath + "/members/{userId}"
	memberRolePath = memberPath + "/role"

	// A name of 30 characters or a role fits easily; anything larger is not
	// a request for these endpoints.
	maxGroupBodyBytes = 4 << 10 // 4 KiB
)

// GroupService is everything the handlers need from groups.
// *group.Service satisfies it; tests use a fake. Embedding GroupIDLister
// adds its GroupIDs method, so the live connection can keep asking for the
// smaller GroupIDLister.
type GroupService interface {
	GroupIDLister
	Create(ctx context.Context, actor uuid.UUID, name string) (group.Details, error)
	List(ctx context.Context, actor uuid.UUID) ([]group.Details, error)
	Get(ctx context.Context, actor, groupID uuid.UUID) (group.Details, error)
	Rename(ctx context.Context, actor, groupID uuid.UUID, name string) (group.Group, error)
	Delete(ctx context.Context, actor, groupID uuid.UUID) error
	RemoveMember(ctx context.Context, actor, groupID, userID uuid.UUID) error
	SetRole(ctx context.Context, actor, groupID, userID uuid.UUID, role group.Role) error
}

// newGroupResponse translates the domain group into the Group schema of the
// API contract. Timestamps are converted to UTC: pgx reads them in the local
// zone of the server, which would put that offset into the JSON.
func newGroupResponse(d group.Details) apigen.Group {
	members := make([]apigen.GroupMember, len(d.Members))
	for i, m := range d.Members {
		members[i] = apigen.GroupMember{
			UserID:      m.UserID,
			DisplayName: m.DisplayName,
			Role:        apigen.Role(m.Role),
			JoinedAt:    m.JoinedAt.UTC(),
		}
		if m.AvatarURL != "" {
			members[i].AvatarURL = &m.AvatarURL
		}
	}
	return apigen.Group{
		ID:        d.ID,
		Name:      d.Name,
		Role:      apigen.Role(d.Role),
		Members:   members,
		CreatedAt: d.CreatedAt.UTC(),
		UpdatedAt: d.UpdatedAt.UTC(),
	}
}

// listGroupsHandler returns the groups of the logged-in user.
func listGroupsHandler(groups GroupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := actorFrom(w, r)
		if !ok {
			return
		}

		details, err := groups.List(r.Context(), actor)
		if err != nil {
			writeGroupError(w, "list groups", err)
			return
		}

		// make instead of a nil slice, so "no groups" is [] and not null.
		resp := apigen.GroupList{Groups: make([]apigen.Group, len(details))}
		for i, d := range details {
			resp.Groups[i] = newGroupResponse(d)
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

func createGroupHandler(groups GroupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := actorFrom(w, r)
		if !ok {
			return
		}
		var req apigen.GroupNameRequest
		if !decodeBody(w, r, &req) {
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

func getGroupHandler(groups GroupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, groupID, ok := actorAndGroupFrom(w, r)
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

func updateGroupHandler(groups GroupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, groupID, ok := actorAndGroupFrom(w, r)
		if !ok {
			return
		}
		var req apigen.GroupNameRequest
		if !decodeBody(w, r, &req) {
			return
		}

		if _, err := groups.Rename(r.Context(), actor, groupID, req.Name); err != nil {
			writeGroupError(w, "rename group", err)
			return
		}
		// Rename returns the bare group; the response carries the members
		// and the caller's role like every other group response.
		d, err := groups.Get(r.Context(), actor, groupID)
		if err != nil {
			writeGroupError(w, "get renamed group", err)
			return
		}
		writeJSON(w, http.StatusOK, newGroupResponse(d))
	}
}

func deleteGroupHandler(groups GroupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, groupID, ok := actorAndGroupFrom(w, r)
		if !ok {
			return
		}

		if err := groups.Delete(r.Context(), actor, groupID); err != nil {
			writeGroupError(w, "delete group", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// removeMemberHandler removes a member, or lets the caller leave if the
// member is the caller.
func removeMemberHandler(groups GroupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, groupID, ok := actorAndGroupFrom(w, r)
		if !ok {
			return
		}
		userID, ok := pathUUID(w, r, "userId")
		if !ok {
			return
		}

		if err := groups.RemoveMember(r.Context(), actor, groupID, userID); err != nil {
			writeGroupError(w, "remove member", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func setMemberRoleHandler(groups GroupService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, groupID, ok := actorAndGroupFrom(w, r)
		if !ok {
			return
		}
		userID, ok := pathUUID(w, r, "userId")
		if !ok {
			return
		}
		var req apigen.SetRoleRequest
		if !decodeBody(w, r, &req) {
			return
		}

		err := groups.SetRole(r.Context(), actor, groupID, userID, group.Role(req.Role))
		if err != nil {
			writeGroupError(w, "set role", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// actorFrom returns the logged-in user set by requireUser. If it is
// missing, the route was registered without requireUser: it answers 500
// and returns false.
func actorFrom(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	userID, ok := userIDFrom(r.Context())
	if !ok {
		slog.Error("groups: no user in request context, route is missing requireUser")
		writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
	}
	return userID, ok
}

// actorAndGroupFrom returns the logged-in user and the group ID from the
// path. On failure it has answered already and returns false.
func actorAndGroupFrom(w http.ResponseWriter, r *http.Request) (actor, groupID uuid.UUID, ok bool) {
	actor, ok = actorFrom(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	groupID, ok = pathUUID(w, r, "groupId")
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	return actor, groupID, true
}

// pathUUID reads a UUID from a path wildcard such as {groupId}. Anything
// else is a malformed request: 400, not 404, because no ID was looked up.
func pathUUID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue(name))
	if err != nil {
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
		return uuid.Nil, false
	}
	return id, true
}

// decodeBody reads a small JSON object into v. On failure it has answered
// 400 already and returns false.
func decodeBody(w http.ResponseWriter, r *http.Request, v any) bool {
	return decodeBodyMax(w, r, v, maxGroupBodyBytes)
}

// decodeBodyMax is decodeBody for a body of at most limit bytes.
func decodeBodyMax(w http.ResponseWriter, r *http.Request, v any, limit int64) bool {
	// Decode fails once the limit is reached, so an oversized body ends up
	// as INVALID_REQUEST like any other broken one.
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
		return false
	}
	return true
}

// writeGroupError maps a domain error to its status and error code. Errors
// it does not know are logged and answered with 500.
func writeGroupError(w http.ResponseWriter, op string, err error) {
	switch {
	case errors.Is(err, group.ErrNotFound):
		writeError(w, http.StatusNotFound, apigen.ErrorCodeGroupNotFound)
	case errors.Is(err, group.ErrForbidden):
		writeError(w, http.StatusForbidden, apigen.ErrorCodeForbidden)
	case errors.Is(err, group.ErrInvalidName):
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeGroupNameInvalid)
	case errors.Is(err, group.ErrInvalidRole):
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRole)
	case errors.Is(err, group.ErrOwnerImmutable):
		writeError(w, http.StatusConflict, apigen.ErrorCodeOwnerImmutable)
	case errors.Is(err, group.ErrTooManyGroups):
		writeError(w, http.StatusConflict, apigen.ErrorCodeTooManyGroups)
	default:
		slog.Error("groups: "+op, "error", err)
		writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
	}
}
