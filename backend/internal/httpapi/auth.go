package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"mitbringsel/internal/config"
	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/user"
)

const (
	logoutPath   = "/api/v1/auth/logout"
	devLoginPath = "/api/v1/auth/dev/login"

	// An email address and a name fit easily; anything larger is not a
	// login request.
	maxDevLoginBodyBytes = 4 << 10 // 4 KiB
)

// logoutHandler deletes the session and the cookie. Without a cookie the
// user is logged out already, which is not an error.
func logoutHandler(sessions SessionManager, env config.Env) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookieName(env))
		// Cleared even if deleting the session fails below: the token only
		// exists in this cookie, so without it the stored session is
		// unusable.
		clearSessionCookie(w, env)
		if err != nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if err := sessions.Delete(r.Context(), cookie.Value); err != nil {
			slog.Error("logout: delete session", "error", err)
			writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// devLoginHandler logs in as any user without Google. The router registers
// it only in development.
func devLoginHandler(users UserService, sessions SessionManager, env config.Env) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Decode fails once the limit is reached, so an oversized body ends
		// up as INVALID_REQUEST like any other broken one.
		r.Body = http.MaxBytesReader(w, r.Body, maxDevLoginBodyBytes)
		var req apigen.DevLoginRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
			return
		}

		u, err := users.SignIn(r.Context(), user.Identity{
			Subject: user.DevSubject(req.Email),
			Email:   req.Email,
			Name:    req.Name,
		})
		if errors.Is(err, user.ErrInvalidIdentity) {
			writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidIdentity)
			return
		}
		if err != nil {
			slog.Error("dev login: sign in", "error", err)
			writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
			return
		}

		token, expiresAt, err := sessions.Create(r.Context(), u.ID)
		if err != nil {
			slog.Error("dev login: create session", "error", err)
			writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
			return
		}

		setSessionCookie(w, env, token, expiresAt)
		w.WriteHeader(http.StatusNoContent)
	}
}
