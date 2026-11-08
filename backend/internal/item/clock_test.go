package item

import (
	"errors"
	"sync"
	"testing"
	"time"
)

// steppedNow returns a time source that yields the given instants one by
// one and then stays at the last one.
func steppedNow(times ...time.Time) func() time.Time {
	i := 0
	return func() time.Time {
		t := times[min(i, len(times)-1)]
		i++
		return t
	}
}

func TestClock_Next(t *testing.T) {
	t.Run("a later millisecond starts the counter again", func(t *testing.T) {
		c, err := NewClock("srv-1", steppedNow(at, at.Add(time.Millisecond)))
		if err != nil {
			t.Fatal(err)
		}
		first, second := c.Next(), c.Next()
		if want := mustHLC(t, at, 0, "srv-1"); first != want {
			t.Errorf("first = %q, want %q", first, want)
		}
		if want := mustHLC(t, at.Add(time.Millisecond), 0, "srv-1"); second != want {
			t.Errorf("second = %q, want %q", second, want)
		}
	})

	t.Run("the same millisecond counts up", func(t *testing.T) {
		c, _ := NewClock("srv-1", steppedNow(at))
		first, second, third := c.Next(), c.Next(), c.Next()
		if first >= second || second >= third {
			t.Errorf("clocks %q, %q, %q are not increasing", first, second, third)
		}
		if third.Counter() != 2 || !third.Wall().Equal(at) {
			t.Errorf("third = %q, want counter 2 at %v", third, at)
		}
	})

	t.Run("a server clock that goes backwards does not go back", func(t *testing.T) {
		c, _ := NewClock("srv-1", steppedNow(at, at.Add(-time.Hour)))
		first, second := c.Next(), c.Next()
		if first >= second {
			t.Errorf("clocks %q, %q are not increasing", first, second)
		}
		if !second.Wall().Equal(at) {
			t.Errorf("wall time = %v, want it to stay at %v", second.Wall(), at)
		}
	})

	t.Run("a full counter borrows the next millisecond", func(t *testing.T) {
		c, _ := NewClock("srv-1", steppedNow(at))
		var last HLC
		for range 65537 { // counter 0 to 65535, and one more
			next := c.Next()
			if next <= last {
				t.Fatalf("%q is not greater than %q", next, last)
			}
			last = next
		}
		if want := mustHLC(t, at.Add(time.Millisecond), 0, "srv-1"); last != want {
			t.Errorf("last = %q, want %q", last, want)
		}
	})

	t.Run("every clock is valid and carries the node", func(t *testing.T) {
		c, _ := NewClock("srv-3f2a9c", time.Now)
		h := c.Next()
		if _, err := ParseHLC(string(h)); err != nil || h.Node() != "srv-3f2a9c" {
			t.Errorf("Next() = %q, %v, want a valid clock of node srv-3f2a9c", h, err)
		}
	})

	t.Run("concurrent callers never get the same clock", func(t *testing.T) {
		c, _ := NewClock("srv-1", steppedNow(at))
		const workers, each = 8, 500
		var (
			mu   sync.Mutex
			seen = make(map[HLC]bool, workers*each)
			wg   sync.WaitGroup
		)
		for range workers {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for range each {
					h := c.Next()
					mu.Lock()
					if seen[h] {
						t.Errorf("clock %q issued twice", h)
					}
					seen[h] = true
					mu.Unlock()
				}
			}()
		}
		wg.Wait()
		if len(seen) != workers*each {
			t.Errorf("got %d different clocks, want %d", len(seen), workers*each)
		}
	})

	t.Run("an issued clock beats an earlier one in Merge", func(t *testing.T) {
		c, _ := NewClock("srv-1", steppedNow(at))
		older, newer := c.Next(), c.Next()
		got, err := Merge(Clocks{FieldName: older}, Clocks{FieldName: newer}, false, at)
		if err != nil || got[FieldName] != newer {
			t.Errorf("Merge() = %v, %v, want the newer clock to win", got, err)
		}
	})
}

func TestNewClock_nodeIsChecked(t *testing.T) {
	for _, node := range []string{"", "a b", "ä"} {
		if _, err := NewClock(node, time.Now); !errors.Is(err, ErrInvalidHLC) {
			t.Errorf("NewClock(%q) error = %v, want %v", node, err, ErrInvalidHLC)
		}
	}
}
