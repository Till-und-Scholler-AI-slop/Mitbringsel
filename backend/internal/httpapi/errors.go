package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// Error codes are part of the API contract: the backend sends codes, the
// frontend translates them into user-facing text.
const (
	CodeNotFound         = "NOT_FOUND"
	CodeMethodNotAllowed = "METHOD_NOT_ALLOWED"
	CodeDBUnavailable    = "DB_UNAVAILABLE"
)

type errorResponse struct {
	Error errorBody `json:"error"`
}

type errorBody struct {
	Code string `json:"code"`
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		// The status line is already sent, so all we can do is log.
		slog.Error("write json response", "error", err)
	}
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, errorResponse{Error: errorBody{Code: code}})
}
