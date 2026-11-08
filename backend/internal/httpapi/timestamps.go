package httpapi

import "time"

// utcPtr converts an optional timestamp to UTC for the API. pgx reads
// timestamps in the local zone of the server, which would put that offset
// into the JSON (docs/conventions.md). A nil stays nil.
func utcPtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	utc := t.UTC()
	return &utc
}
