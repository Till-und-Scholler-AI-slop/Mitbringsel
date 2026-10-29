package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/user"
)

const mePath = "/api/v1/me"

// newMeResponse translates the domain user into the Me schema of the API
// contract. The response type comes from api/openapi.yaml instead of
// user.User with JSON tags, so a new field in the domain does not show up
// in responses unnoticed.
func newMeResponse(u user.User) apigen.Me {
	resp := apigen.Me{
		ID:          u.ID,
		Email:       u.Email,
		DisplayName: u.DisplayName,
		Locale:      apigen.Locale(u.Locale),
		Theme:       apigen.Theme(u.Theme),
	}
	// A nil pointer is written as null, which the contract uses for "no
	// avatar".
	if u.AvatarURL != "" {
		resp.AvatarURL = &u.AvatarURL
	}
	return resp
}

// meHandler returns the logged-in user. It must run behind requireUser.
func meHandler(users UserGetter) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := userIDFrom(r.Context())
		if !ok {
			slog.Error("me: no user in request context, route is missing requireUser")
			writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
			return
		}

		u, err := users.Get(r.Context(), userID)
		// Sessions are deleted together with their user, so this only
		// happens if the user is deleted during the request. Without a
		// user there is nobody logged in.
		if errors.Is(err, user.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, apigen.ErrorCodeUnauthenticated)
			return
		}
		if err != nil {
			slog.Error("me: get user", "error", err)
			writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
			return
		}

		writeJSON(w, http.StatusOK, newMeResponse(u))
	}
}
