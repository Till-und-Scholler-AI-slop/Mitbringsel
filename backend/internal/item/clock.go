package item

import (
	"fmt"
	"math"
	"sync"
	"time"
)

// Clock issues the clocks (HLCs) for changes that the server makes itself,
// like those that arrive over REST. Every clock it returns is greater than
// the one before, so the latest request wins (see Merge), even if two
// requests arrive in the same millisecond or the server clock jumps back.
//
// Changes that arrive over the WebSocket carry the clock of their device and
// do not use this.
type Clock struct {
	node string
	now  func() time.Time

	mu      sync.Mutex // guards the fields below; requests run concurrently
	wallMs  int64
	counter uint16
}

// NewClock returns a clock that stamps its HLCs with the given node. Give
// every server process its own node: two processes with the same node could
// issue the same HLC. now is usually time.Now.
func NewClock(node string, now func() time.Time) (*Clock, error) {
	if !validNode(node) {
		return nil, fmt.Errorf("%w: node must be 1 to %d characters of A-Z, a-z, 0-9, _ and -", ErrInvalidHLC, MaxNodeLength)
	}
	return &Clock{node: node, now: now}, nil
}

// Next returns a new clock, greater than every clock this Clock returned
// before.
func (c *Clock) Next() HLC {
	c.mu.Lock()
	defer c.mu.Unlock()

	if ms := c.now().UnixMilli(); ms > c.wallMs {
		c.wallMs, c.counter = ms, 0
	} else if c.counter == math.MaxUint16 {
		// 65536 clocks within one millisecond: borrow the next one.
		c.wallMs++
		c.counter = 0
	} else {
		// Same millisecond, or the server clock went backwards: keep the
		// wall time and count on.
		c.counter++
	}
	return formatHLC(c.wallMs, c.counter, c.node)
}
