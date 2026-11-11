package realtime

import (
	"sync"

	"github.com/google/uuid"
)

// Client is one open connection as the hub sees it: a queue of outgoing
// messages and a signal for when the hub is done with it. The connection
// layer owns the socket; the hub never touches it.
type Client struct {
	userID uuid.UUID
	// send is never closed: a later send into a closed channel would panic.
	// done is the signal that the connection is gone.
	send      chan []byte
	done      chan struct{}
	closeOnce sync.Once
	hub       *Hub

	// The fields below are guarded by hub.mu, not by a lock of their own.
	groups  map[uuid.UUID]struct{}
	loading bool
	// removedWhileLoading holds the groups that a LeaveGroup or
	// RemoveGroup hit while the groups were still being loaded.
	removedWhileLoading map[uuid.UUID]struct{}
	err                 error
}

// UserID returns the user the connection belongs to.
func (c *Client) UserID() uuid.UUID { return c.userID }

// Send returns the queue of outgoing messages. The writer goroutine of the
// connection reads from it.
func (c *Client) Send() <-chan []byte { return c.send }

// Done is closed when the hub has dropped the connection.
func (c *Client) Done() <-chan struct{} { return c.done }

// Err says why the hub dropped the connection: ErrSlowClient or
// ErrHubClosed. It is nil while the connection is up and after Unregister.
func (c *Client) Err() error {
	c.hub.mu.Lock()
	defer c.hub.mu.Unlock()

	return c.err
}

// registered reports whether c is still in the hub. A dropped connection
// must never get back into a room. The caller holds mu.
func (h *Hub) registered(c *Client) bool {
	_, ok := h.users[c.userID][c]
	return ok
}

// addTo puts c into the room of the group, creating the room on first use.
// The caller holds mu.
func (h *Hub) addTo(c *Client, groupID uuid.UUID) {
	room := h.rooms[groupID]
	if room == nil {
		room = make(map[*Client]struct{})
		h.rooms[groupID] = room
	}
	room[c] = struct{}{}
	c.groups[groupID] = struct{}{}
}

// removeFrom takes c out of the room of the group and forgets the room once
// it is empty, so the map does not grow with every group ever seen. The
// caller holds mu.
func (h *Hub) removeFrom(c *Client, groupID uuid.UUID) {
	delete(c.groups, groupID)
	room := h.rooms[groupID]
	delete(room, c)
	if len(room) == 0 {
		delete(h.rooms, groupID)
	}
}

// drop removes c from every room and from its user, and closes Done. reason
// is kept for Err unless an earlier one is already there; nil means a normal
// Unregister. Unregister, a slow connection and Close all end up here, so
// dropping twice must be harmless. The caller holds mu.
func (h *Hub) drop(c *Client, reason error) {
	for groupID := range c.groups {
		h.removeFrom(c, groupID)
	}

	conns := h.users[c.userID]
	delete(conns, c)
	if len(conns) == 0 {
		delete(h.users, c.userID)
	}

	if c.err == nil {
		c.err = reason
	}
	c.closeOnce.Do(func() { close(c.done) })
}

// markRemoved remembers that a group was removed while c was loading. The
// caller holds mu.
func markRemoved(c *Client, groupID uuid.UUID) {
	if c.removedWhileLoading == nil {
		c.removedWhileLoading = make(map[uuid.UUID]struct{})
	}
	c.removedWhileLoading[groupID] = struct{}{}
}
