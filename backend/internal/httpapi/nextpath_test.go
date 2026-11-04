package httpapi

import (
	"strings"
	"testing"
)

func TestSafeNextPath(t *testing.T) {
	tests := []struct {
		name string
		next string
		want string
	}{
		{name: "invite page", next: "/invite/abc_DEF-123", want: "/invite/abc_DEF-123"},
		{name: "root", next: "/", want: "/"},
		{name: "with query", next: "/invite/abc?x=1", want: "/invite/abc?x=1"},
		{name: "percent encoded", next: "/a%20b", want: "/a%20b"},
		{name: "umlaut", next: "/grüße", want: "/grüße"},

		{name: "empty", next: "", want: ""},
		{name: "no leading slash", next: "invite/abc", want: ""},
		{name: "absolute url", next: "https://evil.example/invite/abc", want: ""},
		{name: "scheme only", next: "javascript:alert(1)", want: ""},
		{name: "protocol relative", next: "//evil.example", want: ""},
		{name: "slash backslash", next: "/\\evil.example", want: ""},
		{name: "backslash later", next: "/invite\\abc", want: ""},
		{name: "tab inside", next: "/\t/evil.example", want: ""},
		{name: "newline", next: "/invite/abc\nSet-Cookie: x=1", want: ""},
		{name: "delete character", next: "/a\x7fb", want: ""},
		{name: "invalid utf-8", next: "/a\xffb", want: ""},
		{name: "too long", next: "/" + strings.Repeat("a", maxNextPathLength), want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := safeNextPath(tt.next); got != tt.want {
				t.Errorf("safeNextPath(%q) = %q, want %q", tt.next, got, tt.want)
			}
		})
	}
}

func TestSafeNextPath_longestAllowed(t *testing.T) {
	next := "/" + strings.Repeat("a", maxNextPathLength-1)
	if got := safeNextPath(next); got != next {
		t.Errorf("a path of exactly %d bytes was refused", maxNextPathLength)
	}
}
