package item

import (
	"errors"
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

func TestParseHLC(t *testing.T) {
	valid := "0000019a2b3c4d5e-0001-3f2a9c"
	if _, err := ParseHLC(valid); err != nil {
		t.Fatalf("ParseHLC(%q) error = %v", valid, err)
	}

	tests := []struct {
		name string
		in   string
	}{
		{"empty", ""},
		{"no node", "0000019a2b3c4d5e-0001-"},
		{"no node and no second dash", "0000019a2b3c4d5e-0001"},
		{"uppercase hex in the wall time", "0000019A2B3C4D5E-0001-a"},
		{"uppercase hex in the counter", "0000019a2b3c4d5e-00AB-a"},
		{"wall time too short", "19a2b3c4d5e-0001-a"},
		{"counter too short", "0000019a2b3c4d5e-1-a"},
		{"not hex", "000000000000000g-0001-a"},
		{"wall time over 63 bits", "ffffffffffffffff-0001-a"},
		{"wrong separator", "0000019a2b3c4d5e_0001_a"},
		{"bad node", "0000019a2b3c4d5e-0001-a b"},
		{"surrounding space", " 0000019a2b3c4d5e-0001-a"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if h, err := ParseHLC(tt.in); !errors.Is(err, ErrInvalidHLC) {
				t.Errorf("ParseHLC(%q) = %q, %v, want %v", tt.in, h, err, ErrInvalidHLC)
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
	tests := []struct {
		name         string
		older, newer HLC
	}{
		{"wall time beats counter and node",
			mustHLC(t, time.UnixMilli(1), 9, "zzz"), mustHLC(t, time.UnixMilli(2), 0, "aaa")},
		{"counter beats node",
			mustHLC(t, time.UnixMilli(2), 1, "zzz"), mustHLC(t, time.UnixMilli(2), 2, "aaa")},
		{"node decides last",
			mustHLC(t, time.UnixMilli(2), 2, "aaa"), mustHLC(t, time.UnixMilli(2), 2, "bbb")},
		// Fixed widths: without the leading zeros "ff" would sort after "100".
		{"wall time across a hex digit boundary",
			mustHLC(t, time.UnixMilli(0xff), 0, "a"), mustHLC(t, time.UnixMilli(0x100), 0, "a")},
		{"counter across a hex digit boundary",
			mustHLC(t, time.UnixMilli(2), 0x0f, "a"), mustHLC(t, time.UnixMilli(2), 0x10, "a")},
		{"today against a far future date",
			mustHLC(t, at, 0, "a"), mustHLC(t, time.UnixMilli(1<<45), 0, "a")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.older >= tt.newer {
				t.Errorf("%q < %q is false, want true", tt.older, tt.newer)
			}
		})
	}
}
