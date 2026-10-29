package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"mitbringsel/internal/user"
)

const mePath = "/api/v1/me"

// meResponse is the JSON shape of GET /api/v1/me. It is a separate type
// instead of user.User with JSON tags, so httpapi decides the API format and
// a new field in the domain does not show up in responses unnoticed.
type meResponse struct {
	ID          uuid.UUID `json:"id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"displayName"`
	// A pointer, because encoding/json writes a nil pointer as null.
	AvatarURL *string     `json:"avatarUrl"`
	Locale    user.Locale `json:"locale"`
	Theme     user.Theme  `json:"theme"`
}

func newMeResponse(u user.User) meResponse {
	resp := meResponse{
		ID:          u.ID,
		Email:       u.Email,
		DisplayName: u.DisplayName,
		Locale:      u.Locale,
		Theme:       u.Theme,
	}
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
			writeError(w, http.StatusInternalServerError, CodeInternal)
			return
		}

		u, err := users.Get(r.Context(), userID)
		// Sessions are deleted together with their user, so this only
		// happens if the user is deleted during the request. Without a
		// user there is nobody logged in.
		if errors.Is(err, user.ErrNotFound) {
			writeError(w, http.StatusUnauthorized, CodeUnauthenticated)
			return
		}
		if err != nil {
			slog.Error("me: get user", "error", err)
			writeError(w, http.StatusInternalServerError, CodeInternal)
			return
		}

		writeJSON(w, http.StatusOK, newMeResponse(u))
	}
}
