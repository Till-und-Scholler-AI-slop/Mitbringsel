package httpapi

import (
	"encoding/json"
	"net/http"

	"mitbringsel/internal/httpapi/apigen"
)

// decodeJSON reads the request body as JSON into dst. If the body is not
// valid JSON or larger than maxBytes, it answers 400 INVALID_REQUEST itself
// and returns false, so the caller only has to return.
func decodeJSON(w http.ResponseWriter, r *http.Request, maxBytes int64, dst any) bool {
	// Decode fails once the limit is reached, so an oversized body ends up
	// as INVALID_REQUEST like any other broken one.
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest)
		return false
	}
	return true
}
