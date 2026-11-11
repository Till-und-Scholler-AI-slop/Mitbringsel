package realtime

import (
	"errors"
	"sync"
	"testing"
	"testing/synctest"

	"github.com/google/uuid"
)

func newTestHub(maxConns, buffer int) *Hub {
	return NewHub(maxConns, buffer)
}

// mustRegister adds a connection that is still loading.
func mustRegister(t *testing.T, h *Hub, userID uuid.UUID) *Client {
	t.Helper()
	c, err := h.Register(userID)
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	return c
}

// mustJoin adds a connection that is done loading and in the given rooms.
func mustJoin(t *testing.T, h *Hub, userID uuid.UUID, groupIDs ...uuid.UUID) *Client {
	t.Helper()
	c := mustRegister(t, h, userID)
	h.JoinInitialGroups(c, groupIDs)
	return c
}

// receive takes the next queued message. Sending happens inside the hub
// call, so a message is either there or it never will be: no waiting needed.
func receive(t *testing.T, c *Client) []byte {
	t.Helper()
	select {
	case msg := <-c.Send():
		return msg
	default:
		t.Fatal("no message queued")
		return nil
	}
}

func requireNothing(t *testing.T, c *Client) {
	t.Helper()
	select {
	case msg := <-c.Send():
		t.Fatalf("unexpected message %q", msg)
	default:
	}
}

func requireDropped(t *testing.T, c *Client, wantErr error) {
	t.Helper()
	select {
	case <-c.Done():
	default:
		t.Fatal("Done is not closed")
	}
	if err := c.Err(); !errors.Is(err, wantErr) {
		t.Errorf("Err = %v, want %v", err, wantErr)
	}
}

func requireOpen(t *testing.T, c *Client) {
	t.Helper()
	select {
	case <-c.Done():
		t.Fatal("Done is closed")
	default:
	}
}

func TestHub_Broadcast(t *testing.T) {
	groupA, groupB := uuid.New(), uuid.New()

	tests := []struct {
		name      string
		groupID   uuid.UUID
		wantInA   bool
		wantInB   bool
		wantInNew bool
	}{
		{name: "only the own room receives", groupID: groupA, wantInA: true},
		{name: "the other room receives its own message", groupID: groupB, wantInB: true},
		{name: "an unknown group is a no-op", groupID: uuid.New()},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHub(DefaultMaxConnsPerUser, 4)
			inA := mustJoin(t, h, uuid.New(), groupA)
			inB := mustJoin(t, h, uuid.New(), groupB)
			// Registered, but still loading: in no room yet.
			loading := mustRegister(t, h, uuid.New())

			h.Broadcast(tt.groupID, []byte("msg"))

			for _, c := range []struct {
				name string
				c    *Client
				want bool
			}{
				{"inA", inA, tt.wantInA},
				{"inB", inB, tt.wantInB},
				{"loading", loading, false},
			} {
				if c.want {
					if got := receive(t, c.c); string(got) != "msg" {
						t.Errorf("%s got %q, want msg", c.name, got)
					}
				}
				requireNothing(t, c.c)
			}
		})
	}
}

func TestHub_Broadcast_userInTwoGroups(t *testing.T) {
	groupA, groupB := uuid.New(), uuid.New()
	user := uuid.New()
	h := newTestHub(DefaultMaxConnsPerUser, 4)
	c := mustJoin(t, h, user, groupA, groupB)

	h.Broadcast(groupA, []byte("a"))
	h.Broadcast(groupB, []byte("b"))
	if got := receive(t, c); string(got) != "a" {
		t.Errorf("first message = %q, want a", got)
	}
	if got := receive(t, c); string(got) != "b" {
		t.Errorf("second message = %q, want b", got)
	}

	h.LeaveGroup(user, groupA)
	h.Broadcast(groupA, []byte("a again"))
	h.Broadcast(groupB, []byte("b again"))
	if got := receive(t, c); string(got) != "b again" {
		t.Errorf("message after leaving = %q, want b again", got)
	}
	requireNothing(t, c)
}

func TestHub_Broadcast_dropsSlowClient(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		groupID := uuid.New()
		slowUser := uuid.New()
		h := newTestHub(1, 1)
		slow := mustJoin(t, h, slowUser, groupID)
		fast := mustJoin(t, h, uuid.New(), groupID)

		h.Broadcast(groupID, []byte("one"))
		// The fast client reads, the slow one does not.
		if got := receive(t, fast); string(got) != "one" {
			t.Fatalf("fast got %q, want one", got)
		}
		requireOpen(t, slow)

		h.Broadcast(groupID, []byte("two"))

		requireDropped(t, slow, ErrSlowClient)
		requireOpen(t, fast)
		if got := receive(t, fast); string(got) != "two" {
			t.Errorf("fast got %q, want two", got)
		}

		// The slow client is out of the room, and its slot is free again.
		h.Broadcast(groupID, []byte("three"))
		if got := receive(t, fast); string(got) != "three" {
			t.Errorf("fast got %q, want three", got)
		}
		receive(t, slow) // the one message it still had queued
		requireNothing(t, slow)
		if _, err := h.Register(slowUser); err != nil {
			t.Errorf("Register after the drop: %v", err)
		}
	})
}

func TestHub_SendToUser(t *testing.T) {
	user := uuid.New()
	h := newTestHub(DefaultMaxConnsPerUser, 4)
	joined := mustJoin(t, h, user, uuid.New())
	loading := mustRegister(t, h, user)
	other := mustJoin(t, h, uuid.New())

	h.SendToUser(user, []byte("msg"))

	if got := receive(t, joined); string(got) != "msg" {
		t.Errorf("joined got %q, want msg", got)
	}
	if got := receive(t, loading); string(got) != "msg" {
		t.Errorf("loading got %q, want msg", got)
	}
	requireNothing(t, other)
}

func TestHub_SendToClient(t *testing.T) {
	t.Run("reaches only that connection", func(t *testing.T) {
		user := uuid.New()
		h := newTestHub(DefaultMaxConnsPerUser, 4)
		target := mustRegister(t, h, user)
		sibling := mustRegister(t, h, user)

		h.SendToClient(target, []byte("ready"))

		if got := receive(t, target); string(got) != "ready" {
			t.Errorf("target got %q, want ready", got)
		}
		requireNothing(t, sibling)
	})

	t.Run("a full buffer drops the connection", func(t *testing.T) {
		h := newTestHub(DefaultMaxConnsPerUser, 1)
		c := mustRegister(t, h, uuid.New())

		h.SendToClient(c, []byte("one"))
		h.SendToClient(c, []byte("two"))

		requireDropped(t, c, ErrSlowClient)
	})

	t.Run("a dropped connection gets nothing", func(t *testing.T) {
		h := newTestHub(DefaultMaxConnsPerUser, 4)
		c := mustRegister(t, h, uuid.New())
		h.Unregister(c)

		h.SendToClient(c, []byte("late"))

		requireNothing(t, c)
	})
}

func TestHub_LeaveGroup(t *testing.T) {
	groupA, groupB := uuid.New(), uuid.New()
	user := uuid.New()
	h := newTestHub(DefaultMaxConnsPerUser, 4)
	leaving1 := mustJoin(t, h, user, groupA, groupB)
	leaving2 := mustJoin(t, h, user, groupA)
	staying := mustJoin(t, h, uuid.New(), groupA)

	h.LeaveGroup(user, groupA)
	h.Broadcast(groupA, []byte("a"))
	h.Broadcast(groupB, []byte("b"))

	requireNothing(t, leaving2)
	if got := receive(t, leaving1); string(got) != "b" {
		t.Errorf("leaving1 got %q, want b", got)
	}
	requireNothing(t, leaving1)
	if got := receive(t, staying); string(got) != "a" {
		t.Errorf("staying got %q, want a", got)
	}
	requireOpen(t, leaving1)
}

func TestHub_RemoveGroup(t *testing.T) {
	groupA, groupB := uuid.New(), uuid.New()
	h := newTestHub(DefaultMaxConnsPerUser, 4)
	c1 := mustJoin(t, h, uuid.New(), groupA, groupB)
	c2 := mustJoin(t, h, uuid.New(), groupA)

	h.RemoveGroup(groupA)
	h.Broadcast(groupA, []byte("a"))
	h.Broadcast(groupB, []byte("b"))

	requireNothing(t, c2)
	if got := receive(t, c1); string(got) != "b" {
		t.Errorf("c1 got %q, want b", got)
	}
	requireNothing(t, c1)
}

func TestHub_JoinInitialGroups(t *testing.T) {
	user := uuid.New()
	groupA, groupB, groupX := uuid.New(), uuid.New(), uuid.New()
	loaded := []uuid.UUID{groupA, groupB}

	tests := []struct {
		name string
		// during runs after Register, before JoinInitialGroups; after runs
		// once loading is over.
		during func(h *Hub)
		after  func(h *Hub)
		// wantA, wantB and wantX say which rooms the connection is in.
		wantA, wantB, wantX bool
	}{
		{
			name:  "no change joins all loaded groups",
			wantA: true, wantB: true,
		},
		{
			name:   "a leave during loading skips that group",
			during: func(h *Hub) { h.LeaveGroup(user, groupA) },
			wantB:  true,
		},
		{
			name: "a join after a leave during loading keeps the group",
			during: func(h *Hub) {
				h.LeaveGroup(user, groupA)
				h.JoinGroup(user, groupA)
			},
			wantA: true, wantB: true,
		},
		{
			name:   "a removed group during loading is skipped",
			during: func(h *Hub) { h.RemoveGroup(groupA) },
			wantB:  true,
		},
		{
			name:   "a join during loading for an unloaded group is kept",
			during: func(h *Hub) { h.JoinGroup(user, groupX) },
			wantA:  true, wantB: true, wantX: true,
		},
		{
			name:  "a leave after loading takes the group out",
			after: func(h *Hub) { h.LeaveGroup(user, groupA) },
			wantB: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := newTestHub(DefaultMaxConnsPerUser, 4)
			c := mustRegister(t, h, user)

			if tt.during != nil {
				tt.during(h)
			}
			h.JoinInitialGroups(c, loaded)
			if tt.after != nil {
				tt.after(h)
			}

			for _, room := range []struct {
				name    string
				groupID uuid.UUID
				want    bool
			}{
				{"A", groupA, tt.wantA},
				{"B", groupB, tt.wantB},
				{"X", groupX, tt.wantX},
			} {
				h.Broadcast(room.groupID, []byte(room.name))
				if room.want {
					if got := receive(t, c); string(got) != room.name {
						t.Errorf("room %s: got %q", room.name, got)
					}
				}
				requireNothing(t, c)
			}
		})
	}
}

func TestHub_JoinInitialGroups_afterDropIsNoop(t *testing.T) {
	groupID := uuid.New()
	h := newTestHub(DefaultMaxConnsPerUser, 4)
	c := mustRegister(t, h, uuid.New())
	h.Unregister(c)

	h.JoinInitialGroups(c, []uuid.UUID{groupID})
	h.Broadcast(groupID, []byte("msg"))

	requireNothing(t, c)
	if len(h.rooms) != 0 {
		t.Errorf("a dropped connection re-entered a room: %d rooms", len(h.rooms))
	}
}

func TestHub_Register_limitPerUser(t *testing.T) {
	user := uuid.New()

	t.Run("the connection over the limit is rejected", func(t *testing.T) {
		h := newTestHub(DefaultMaxConnsPerUser, 4)
		first := mustRegister(t, h, user)
		for range DefaultMaxConnsPerUser - 1 {
			mustRegister(t, h, user)
		}

		if _, err := h.Register(user); !errors.Is(err, ErrTooManyConnections) {
			t.Fatalf("Register over the limit: err = %v, want ErrTooManyConnections", err)
		}
		// The oldest connection is not evicted to make room.
		requireOpen(t, first)
		// Other users are not affected.
		mustRegister(t, h, uuid.New())
	})

	t.Run("Unregister frees a slot", func(t *testing.T) {
		h := newTestHub(2, 4)
		c := mustRegister(t, h, user)
		mustRegister(t, h, user)

		h.Unregister(c)

		mustRegister(t, h, user)
	})

	t.Run("a drop frees a slot", func(t *testing.T) {
		groupID := uuid.New()
		h := newTestHub(2, 1)
		mustJoin(t, h, user, groupID)
		mustRegister(t, h, user)

		// The first connection never reads: the second message drops it.
		h.Broadcast(groupID, []byte("one"))
		h.Broadcast(groupID, []byte("two"))

		mustRegister(t, h, user)
	})
}

func TestHub_Unregister_twice(t *testing.T) {
	groupID := uuid.New()
	h := newTestHub(DefaultMaxConnsPerUser, 4)
	c := mustJoin(t, h, uuid.New(), groupID)

	h.Unregister(c)
	h.Unregister(c)

	requireDropped(t, c, nil)
	if err := c.Err(); err != nil {
		t.Errorf("Err = %v, want nil after Unregister", err)
	}
	h.Broadcast(groupID, []byte("msg"))
	requireNothing(t, c)
}

func TestHub_Close(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		groupID := uuid.New()
		user := uuid.New()
		h := newTestHub(DefaultMaxConnsPerUser, 1)
		full := mustJoin(t, h, user, groupID)
		loading := mustRegister(t, h, uuid.New())
		// One message fills the buffer of "full" without dropping it.
		h.Broadcast(groupID, []byte("fills the buffer"))

		h.Close()

		requireDropped(t, full, ErrHubClosed)
		requireDropped(t, loading, ErrHubClosed)
		if _, err := h.Register(user); !errors.Is(err, ErrHubClosed) {
			t.Errorf("Register after Close: err = %v, want ErrHubClosed", err)
		}

		// Everything else is harmless after Close.
		h.Unregister(full)
		h.Broadcast(groupID, []byte("late"))
		h.SendToUser(user, []byte("late"))
		h.JoinGroup(user, groupID)
		h.LeaveGroup(user, groupID)
		h.RemoveGroup(groupID)
		h.Close()

		receive(t, full) // the message from before Close
		requireNothing(t, full)
		requireNothing(t, loading)
		if err := full.Err(); !errors.Is(err, ErrHubClosed) {
			t.Errorf("Err = %v, want ErrHubClosed to stay", err)
		}
	})
}

// TestHub_forgetsEmptyRooms is the one test that looks inside: nothing a
// caller can observe tells whether empty rooms pile up.
func TestHub_forgetsEmptyRooms(t *testing.T) {
	groupA, groupB := uuid.New(), uuid.New()
	user := uuid.New()
	h := newTestHub(DefaultMaxConnsPerUser, 4)
	a := mustJoin(t, h, user, groupA, groupB)
	b := mustJoin(t, h, uuid.New(), groupA)

	h.LeaveGroup(user, groupB)
	if _, ok := h.rooms[groupB]; ok {
		t.Error("room B still there after its last member left")
	}
	h.Unregister(a)
	h.Unregister(b)

	if len(h.rooms) != 0 || len(h.users) != 0 {
		t.Errorf("rooms = %d, users = %d, want both empty", len(h.rooms), len(h.users))
	}
}

// TestHub_concurrentUse has no synctest on purpose: it needs real
// parallelism for -race to find unguarded access. It checks that nothing
// panics, deadlocks or leaves state behind.
func TestHub_concurrentUse(t *testing.T) {
	const (
		users      = 8
		workers    = 4 // goroutines per user, more than the limit below
		iterations = 200
	)
	groups := []uuid.UUID{uuid.New(), uuid.New(), uuid.New()}
	// A small limit and buffer make rejections and slow drops happen.
	h := newTestHub(3, 2)

	var (
		producers, readers sync.WaitGroup
		mu                 sync.Mutex
		leftOpen           []*Client
	)
	for u := range users {
		userID := uuid.New()
		for w := range workers {
			producers.Go(func() {
				for i := range iterations {
					c, err := h.Register(userID)
					if errors.Is(err, ErrTooManyConnections) {
						continue
					}
					if err != nil {
						t.Errorf("Register: %v", err)
						return
					}
					// The reader drains the queue until the hub is done.
					readers.Go(func() {
						for {
							select {
							case <-c.Send():
							case <-c.Done():
								return
							}
						}
					})

					g1, g2 := groups[(u+w+i)%len(groups)], groups[(u+w+i+1)%len(groups)]
					h.JoinInitialGroups(c, []uuid.UUID{g1})
					h.SendToClient(c, []byte("ready"))
					h.JoinGroup(userID, g2)
					h.Broadcast(g1, []byte("msg"))
					h.Broadcast(g2, []byte("msg"))
					h.SendToUser(userID, []byte("msg"))
					h.LeaveGroup(userID, g1)
					if i%50 == 0 {
						h.RemoveGroup(g2)
					}

					if i%5 == 0 {
						// Left for Close to clean up.
						mu.Lock()
						leftOpen = append(leftOpen, c)
						mu.Unlock()
						continue
					}
					h.Unregister(c)
				}
			})
		}
	}
	producers.Wait()

	h.Close()
	readers.Wait()

	for _, c := range leftOpen {
		select {
		case <-c.Done():
		default:
			t.Fatal("a connection is still open after Close")
		}
		// It was either dropped as too slow before Close, or by Close.
		if err := c.Err(); !errors.Is(err, ErrHubClosed) && !errors.Is(err, ErrSlowClient) {
			t.Errorf("Err = %v, want ErrHubClosed or ErrSlowClient", err)
		}
	}
	if len(h.rooms) != 0 || len(h.users) != 0 {
		t.Errorf("rooms = %d, users = %d, want both empty", len(h.rooms), len(h.users))
	}
}
