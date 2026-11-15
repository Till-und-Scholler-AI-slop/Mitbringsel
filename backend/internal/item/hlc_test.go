package item

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

// at is a fixed moment for the tests.
var at = time.Date(2026, time.March, 1, 10, 0, 0, 0, time.UTC)

func mustHLC(t *testing.T, wall time.Time, counter uint16, node string) HLC {
	t.Helper()
	h, err := NewHLC(wall, counter, node)
	if err != nil {
		t.Fatalf("NewHLC(%v, %d, %q) error = %v", wall, counter, node, err)
	}
	return h
}

func TestNewHLC(t *testing.T) {
	t.Run("fixed format", func(t *testing.T) {
		got := mustHLC(t, time.UnixMilli(0x19a2b3c4d5e), 1, "3f2a9c")
		if want := HLC("0000019a2b3c4d5e-0001-3f2a9c"); got != want {
			t.Errorf("NewHLC() = %q, want %q", got, want)
		}
	})

	t.Run("round trip", func(t *testing.T) {
		h := mustHLC(t, at, 0xbeef, "Anna-Handy_2")
		if !h.Wall().Equal(at) || h.Counter() != 0xbeef || h.Node() != "Anna-Handy_2" {
			t.Errorf("parts = %v, %d, %q", h.Wall(), h.Counter(), h.Node())
		}
		parsed, err := ParseHLC(string(h))
		if err != nil || parsed != h {
			t.Errorf("ParseHLC() = %q, %v, want %q", parsed, err, h)
		}
	})

	t.Run("uuid as node", func(t *testing.T) {
		node := "0190a8c4-0000-7000-8000-0000000000b1"
		h := mustHLC(t, at, 0, node)
		if h.Node() != node {
			t.Errorf("Node() = %q, want %q", h.Node(), node)
		}
	})

	t.Run("refused", func(t *testing.T) {
		tests := []struct {
			name string
			wall time.Time
			node string
		}{
			{"before 1970", time.UnixMilli(-1), "a"},
			{"empty node", at, ""},
			{"node with a space", at, "a b"},
			{"node with a dot", at, "a.b"},
			{"node over the limit", at, strings.Repeat("a", MaxNodeLength+1)},
		}
		for _, tt := range tests {
			t.Run(tt.name, func(t *testing.T) {
				if _, err := NewHLC(tt.wall, 0, tt.node); !errors.Is(err, ErrInvalidHLC) {
					t.Errorf("error = %v, want %v", err, ErrInvalidHLC)
				}
			})
		}
	})

	t.Run("node at the limit", func(t *testing.T) {
		mustHLC(t, at, 0, strings.Repeat("a", MaxNodeLength))
	})
}

// hlcCases are the test cases shared with the frontend (api/testdata), so
// the Go and the TypeScript clock agree on what is valid and on the order.
type hlcCases struct {
	Valid []struct {
		Name string `json:"name"`
		In   string `json:"in"`
	} `json:"valid"`
	Invalid []struct {
		Name string `json:"name"`
		In   string `json:"in"`
	} `json:"invalid"`
	Ordered []struct {
		Name  string `json:"name"`
		Older string `json:"older"`
		Newer string `json:"newer"`
	} `json:"ordered"`
}

func loadHLCCases(t *testing.T) hlcCases {
	t.Helper()
	// Tests run in the package directory; the file is at the repository root.
	data, err := os.ReadFile("../../../api/testdata/hlc.json")
	if err != nil {
		t.Fatalf("read shared cases: %v", err)
	}
	var cases hlcCases
	if err := json.Unmarshal(data, &cases); err != nil {
		t.Fatalf("decode shared cases: %v", err)
	}
	return cases
}

func TestParseHLC(t *testing.T) {
	cases := loadHLCCases(t)

	for _, tt := range cases.Valid {
		t.Run("valid: "+tt.Name, func(t *testing.T) {
			h, err := ParseHLC(tt.In)
			if err != nil || string(h) != tt.In {
				t.Fatalf("ParseHLC(%q) = %q, %v", tt.In, h, err)
			}
			// Building it again from its parts gives the same string.
			if again := mustHLC(t, h.Wall(), h.Counter(), h.Node()); again != h {
				t.Errorf("NewHLC(parts) = %q, want %q", again, h)
			}
		})
	}

	for _, tt := range cases.Invalid {
		t.Run("invalid: "+tt.Name, func(t *testing.T) {
			if h, err := ParseHLC(tt.In); !errors.Is(err, ErrInvalidHLC) {
				t.Errorf("ParseHLC(%q) = %q, %v, want %v", tt.In, h, err, ErrInvalidHLC)
			}
		})
	}

	t.Run("an invalid clock has zero parts", func(t *testing.T) {
		h := HLC("nonsense")
		if !h.Wall().IsZero() || h.Counter() != 0 || h.Node() != "" {
			t.Errorf("parts = %v, %d, %q, want zero values", h.Wall(), h.Counter(), h.Node())
		}
	})
}

// TestHLC_stringOrderIsClockOrder is the property the whole design rests on:
// comparing the strings compares the clocks by wall time, then counter, then
// node.
func TestHLC_stringOrderIsClockOrder(t *testing.T) {
	for _, tt := range loadHLCCases(t).Ordered {
		t.Run(tt.Name, func(t *testing.T) {
			older, errOlder := ParseHLC(tt.Older)
			newer, errNewer := ParseHLC(tt.Newer)
			if errOlder != nil || errNewer != nil {
				t.Fatalf("invalid case: %v, %v", errOlder, errNewer)
			}
			if older >= newer {
				t.Errorf("%q < %q is false, want true", older, newer)
			}
		})
	}
}
