package httpapi

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
	"time"
)

// testZone has a fixed offset, like the local zone pgx puts on every time it
// reads when the server does not run in UTC. The fixtures of the handler
// tests use it, so a mapper that forgets to convert to UTC is caught.
var testZone = time.FixedZone("CET", 3600)

var timestampPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T`)

// requireUTCTimestamps fails if a timestamp in the JSON body is not written
// in UTC (ending in "Z"), and also if the body has no timestamp at all, so
// the check cannot pass by looking at the wrong body. It looks at every
// string value that looks like a date, so new fields are covered, too.
func requireUTCTimestamps(t *testing.T, body []byte) {
	t.Helper()
	var doc any
	if err := json.Unmarshal(body, &doc); err != nil {
		t.Fatalf("decode body %s: %v", body, err)
	}

	found := 0
	var walk func(v any)
	walk = func(v any) {
		switch v := v.(type) {
		case string:
			if !timestampPattern.MatchString(v) {
				return
			}
			found++
			if !strings.HasSuffix(v, "Z") {
				t.Errorf("timestamp %q is not in UTC", v)
			}
		case []any:
			for _, e := range v {
				walk(e)
			}
		case map[string]any:
			for _, e := range v {
				walk(e)
			}
		}
	}
	walk(doc)

	if found == 0 {
		t.Errorf("body has no timestamps: %s", body)
	}
}
