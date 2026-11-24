package httpapi

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"tuolino/internal/group"
	"tuolino/internal/httpapi/apigen"
)

const (
	groupInvitesPath = groupPath + "/invites"
	groupInvitePath  = groupInvitesPath + "/{inviteId}"
	invitePath       = "/api/v1/invites/{token}"
	inviteAcceptPath = invitePath + "/accept"
)

// InviteService is everything the handlers need from invites.
// *group.InviteService satisfies it; tests use a fake.
type InviteService interface {
	Create(ctx context.Context, actor, groupID uuid.UUID) (string, group.Invite, error)
	List(ctx context.Context, actor, groupID uuid.UUID) ([]group.Invite, error)
	Revoke(ctx context.Context, actor, groupID, inviteID uuid.UUID) error
	Preview(ctx context.Context, token string) (group.InvitePreview, error)
	Accept(ctx context.Context, actor uuid.UUID, token string) (group.Group, error)
}

func newInviteResponse(i group.Invite) apigen.Invite {
	return apigen.Invite{
		ID:            i.ID,
		CreatedAt:     i.CreatedAt.UTC(),
		ExpiresAt:     i.ExpiresAt.UTC(),
		CreatedBy:     i.CreatedBy,
		CreatedByName: nullIfEmpty(i.CreatedByName),
	}
}

func newInvitePreviewResponse(p group.InvitePreview) apigen.InvitePreview {
	members := make([]apigen.InviteMember, len(p.Members))
	for i, m := range p.Members {
		members[i] = apigen.InviteMember{FirstName: m.FirstName, AvatarURL: nullIfEmpty(m.AvatarURL)}
	}
	return apigen.InvitePreview{
		GroupName:          p.GroupName,
		InvitedByName:      nullIfEmpty(p.InvitedBy),
		InvitedByAvatarURL: nullIfEmpty(p.InvitedByAvatarURL),
		ExpiresAt:          p.ExpiresAt.UTC(),
		MemberCount:        p.MemberCount,
		Members:            members,
	}
}

// nullIfEmpty writes an empty string as null, which the contract uses for
// "not there".
func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func listInvitesHandler(invites InviteService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, groupID, ok := actorAndGroupFrom(w, r)
		if !ok {
			return
		}

		list, err := invites.List(r.Context(), actor, groupID)
		if err != nil {
			writeInviteError(w, "list invites", err)
			return
		}

		// make instead of a nil slice, so "no invites" is [] and not null.
		resp := apigen.InviteList{Invites: make([]apigen.Invite, len(list))}
		for i, invite := range list {
			resp.Invites[i] = newInviteResponse(invite)
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

func createInviteHandler(invites InviteService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, groupID, ok := actorAndGroupFrom(w, r)
		if !ok {
			return
		}

		token, invite, err := invites.Create(r.Context(), actor, groupID)
		if err != nil {
			writeInviteError(w, "create invite", err)
			return
		}

		// The body holds a secret that is shown only once: no cache may
		// keep it.
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusCreated, apigen.InviteCreated{
			ID:            invite.ID,
			CreatedAt:     invite.CreatedAt.UTC(),
			ExpiresAt:     invite.ExpiresAt.UTC(),
			CreatedBy:     invite.CreatedBy,
			CreatedByName: nullIfEmpty(invite.CreatedByName),
			Token:         token,
		})
	}
}

func revokeInviteHandler(invites InviteService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, groupID, ok := actorAndGroupFrom(w, r)
		if !ok {
			return
		}
		inviteID, ok := pathUUID(w, r, "inviteId")
		if !ok {
			return
		}

		if err := invites.Revoke(r.Context(), actor, groupID, inviteID); err != nil {
			writeInviteError(w, "revoke invite", err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// previewInviteHandler shows what an invite link leads to. It runs without
// requireUser: the page behind the link shows the invitation before the
// visitor has signed in.
func previewInviteHandler(invites InviteService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		preview, err := invites.Preview(r.Context(), r.PathValue("token"))
		if err != nil {
			writeInviteError(w, "preview invite", err)
			return
		}

		// Members can join or leave and the invite can be revoked, so a
		// cached answer would be wrong soon.
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, newInvitePreviewResponse(preview))
	}
}

func acceptInviteHandler(invites InviteService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		actor, ok := actorFrom(w, r)
		if !ok {
			return
		}

		g, err := invites.Accept(r.Context(), actor, r.PathValue("token"))
		if err != nil {
			writeInviteError(w, "accept invite", err)
			return
		}
		writeJSON(w, http.StatusOK, apigen.InviteAccepted{GroupID: g.ID, GroupName: g.Name})
	}
}

// writeInviteError maps the invite errors to their status and code. The
// rest (group not found, forbidden, unknown errors) is handled like in the
// group endpoints. The token is never logged: the log would hold a working
// invite.
func writeInviteError(w http.ResponseWriter, op string, err error) {
	switch {
	case errors.Is(err, group.ErrInviteNotFound):
		writeError(w, http.StatusNotFound, apigen.ErrorCodeInviteNotFound)
	case errors.Is(err, group.ErrInviteExpired):
		writeError(w, http.StatusGone, apigen.ErrorCodeInviteExpired)
	case errors.Is(err, group.ErrTooManyInvites):
		writeError(w, http.StatusConflict, apigen.ErrorCodeTooManyInvites)
	default:
		writeGroupError(w, op, err)
	}
}
