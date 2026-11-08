// Package item holds the items on a shopping list. This part is the
// conflict resolution: the clock that stamps every change (HLC) and the rule
// that decides which change wins (Merge). The service and the repository
// follow in their own step.
package item

import (
	"errors"
	"fmt"
	"strconv"
	"time"
)

const (
	wallDigits    = 16 // hex digits for the milliseconds
	counterDigits = 4  // hex digits for the counter
	// The node starts after "<wall>-<counter>-".
	nodeStart = wallDigits + 1 + counterDigits + 1

	// MaxNodeLength is the longest node ID in characters.
	MaxNodeLength = 64
)

// ErrInvalidHLC means a string is not a hybrid logical clock in the format
// described at HLC.
var ErrInvalidHLC = errors.New("invalid hybrid logical clock")

// HLC (hybrid logical clock) stamps one change of one field. It says when
// the change happened and which device made it; it does not identify the
// item. The latest HLC of a field wins (docs/sync.md).
//
// It is a string of fixed format, "<wall>-<counter>-<node>", for example
// 0000019a2b3c4d5e-0001-3f2a9c. The parts are:
//
// wall is the time in milliseconds since the Unix epoch, 16 lowercase hex
// digits. counter is 4 lowercase hex digits; it orders changes within the
// same millisecond and keeps the order if a device clock runs behind. node is
// the device (client), 1 to 64 characters of A-Z, a-z, 0-9, "_" and "-"; it
// decides only if wall and counter are equal.
//
// Because of the fixed widths, comparing two HLCs as plain strings (<, >)
// gives the clock order, in Go as well as in TypeScript. HLC is its own type
// so that a clock cannot be mixed up with any other string.
type HLC string

// NewHLC builds a clock from its parts.
func NewHLC(wall time.Time, counter uint16, node string) (HLC, error) {
	ms := wall.UnixMilli()
	if ms < 0 {
		return "", fmt.Errorf("%w: time before 1970", ErrInvalidHLC)
	}
	if !validNode(node) {
		return "", fmt.Errorf("%w: node must be 1 to %d characters of A-Z, a-z, 0-9, _ and -", ErrInvalidHLC, MaxNodeLength)
	}
	return formatHLC(ms, counter, node), nil
}

// formatHLC writes the parts in the fixed format. The caller has checked
// them.
func formatHLC(wallMs int64, counter uint16, node string) HLC {
	return HLC(fmt.Sprintf("%0*x-%0*x-%s", wallDigits, wallMs, counterDigits, counter, node))
}

// ParseHLC checks that s is a clock in the exact format and returns it. Only
// the exact format keeps the string order equal to the clock order, so
// uppercase hex digits and missing zeros are refused.
func ParseHLC(s string) (HLC, error) {
	h := HLC(s)
	if _, err := h.parts(); err != nil {
		return "", err
	}
	return h, nil
}

// Wall returns the time of the change, in UTC. It is the zero time for an
// invalid clock.
func (h HLC) Wall() time.Time {
	p, err := h.parts()
	if err != nil {
		return time.Time{}
	}
	return time.UnixMilli(p.wallMs).UTC()
}

// Counter returns the counter, 0 for an invalid clock.
func (h HLC) Counter() uint16 {
	p, _ := h.parts()
	return p.counter
}

// Node returns the device, empty for an invalid clock.
func (h HLC) Node() string {
	p, _ := h.parts()
	return p.node
}

type hlcParts struct {
	wallMs  int64
	counter uint16
	node    string
}

func (h HLC) parts() (hlcParts, error) {
	s := string(h)
	if len(s) <= nodeStart || s[wallDigits] != '-' || s[nodeStart-1] != '-' {
		return hlcParts{}, fmt.Errorf("%w: wrong shape", ErrInvalidHLC)
	}
	wallHex, counterHex, node := s[:wallDigits], s[wallDigits+1:nodeStart-1], s[nodeStart:]
	if !lowerHex(wallHex) || !lowerHex(counterHex) {
		return hlcParts{}, fmt.Errorf("%w: wall and counter must be lowercase hex", ErrInvalidHLC)
	}
	if !validNode(node) {
		return hlcParts{}, fmt.Errorf("%w: bad node", ErrInvalidHLC)
	}
	// 63 bits: the wall time of an HLC fits an int64 of milliseconds.
	wall, err := strconv.ParseUint(wallHex, 16, 63)
	if err != nil {
		return hlcParts{}, fmt.Errorf("%w: wall time too large", ErrInvalidHLC)
	}
	counter, err := strconv.ParseUint(counterHex, 16, 16)
	if err != nil {
		return hlcParts{}, fmt.Errorf("%w: bad counter", ErrInvalidHLC)
	}
	return hlcParts{wallMs: int64(wall), counter: uint16(counter), node: node}, nil
}

func lowerHex(s string) bool {
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

func validNode(node string) bool {
	if node == "" || len(node) > MaxNodeLength {
		return false
	}
	for _, c := range node {
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '_', c == '-':
		default:
			return false
		}
	}
	return true
}
