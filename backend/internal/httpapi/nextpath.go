package httpapi

import (
	"net/url"
	"unicode/utf8"
)

// nextParam is the query parameter of the login page and the login endpoint
// that says where to go once the user is signed in.
const nextParam = "next"

// maxNextPathLength keeps the return path small enough for the login cookie.
const maxNextPathLength = 512

// safeNextPath returns next if it is a path inside this app, and "" if not.
//
// The user is sent to this path after the login, so it must never lead to
// another site (an "open redirect": a link that signs you in on the real
// site and then drops you on a fake one). Only paths that start with a
// single "/" pass. Browsers read "//host" and "/\host" as another host, and
// control characters (tab, newline) are silently dropped from URLs by
// browsers, which would turn "/\t/host" into "//host".
func safeNextPath(next string) string {
	if next == "" || len(next) > maxNextPathLength || next[0] != '/' {
		return ""
	}
	if len(next) > 1 && (next[1] == '/' || next[1] == '\\') {
		return ""
	}
	if !utf8.ValidString(next) {
		return ""
	}
	// Ranging over a string yields runes, so multi-byte characters pass as one.
	for _, r := range next {
		if r < 0x20 || r == 0x7f || r == '\\' {
			return ""
		}
	}
	u, err := url.Parse(next)
	if err != nil || u.Scheme != "" || u.Host != "" {
		return ""
	}
	return next
}
