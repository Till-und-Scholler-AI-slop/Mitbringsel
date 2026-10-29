package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"mitbringsel/internal/httpapi/apigen"
)

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		// The status line is already sent, so all we can do is log.
		slog.Error("write json response", "error", err)
	}
}

// writeError answers in the error format of the API contract. The codes are
// defined in api/openapi.yaml, so the frontend knows every one of them.
func writeError(w http.ResponseWriter, status int, code apigen.ErrorCode) {
	writeJSON(w, status, apigen.Error{Error: apigen.ErrorBody{Code: code}})
}
