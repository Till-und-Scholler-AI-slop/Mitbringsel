// Package realtime keeps the open live connections in rooms, one per group,
// and moves bytes into them. It knows nothing about items, lists or JSON.
package realtime

import (
	"errors"
	"sync"

	"github.com/google/uuid"
)

const (
	// DefaultMaxConnsPerUser is how many connections one user may hold at
	// once (ADR 0005): a few devices and tabs, but not unlimited.
	DefaultMaxConnsPerUser = 10
	// DefaultSendBuffer is how many messages may wait for one connection
	// before it counts as too slow.
	DefaultSendBuffer = 64
)

var (
	// ErrTooManyConnections means the user is at the connection limit.
	ErrTooManyConnections = errors.New("realtime: too many connections for this user")
	// ErrHubClosed means the hub is shut down; also the reason of the
	// connections it closed.
	ErrHubClosed = errors.New("realtime: hub closed")
	// ErrSlowClient is the reason of a connection that was dropped because
	// its send buffer was full.
	ErrSlowClient = errors.New("realtime: send buffer full")
)

// Hub holds the connections of all users and the rooms they are in. Every
// method is safe for concurrent use, and none of them blocks: sending only
// ever queues a message, so one slow connection cannot hold up the others.
type Hub struct {
	// maxConnsPerUser and sendBuffer never change after NewHub.
	maxConnsPerUser int
	sendBuffer      int

	// mu guards the fields below and the guarded fields of every Client:
	// requests and the writers of many connections call in at once.
	mu     sync.Mutex
	rooms  map[uuid.UUID]map[*Client]struct{} // groupID -> connections
	users  map[uuid.UUID]map[*Client]struct{} // userID  -> connections
	closed bool
}

// NewHub allows maxConnsPerUser connections per user, each queueing up to
// sendBuffer messages. Both must be at least 1.
func NewHub(maxConnsPerUser, sendBuffer int) *Hub {
	return &Hub{
		maxConnsPerUser: maxConnsPerUser,
		sendBuffer:      sendBuffer,
		rooms:           make(map[uuid.UUID]map[*Client]struct{}),
		users:           make(map[uuid.UUID]map[*Client]struct{}),
	}
}

// Register adds a connection for the user. It is in no room yet ("loading"):
// the caller loads the user's groups next and passes them to
// JoinInitialGroups. Registering first closes the gap in which a membership
// change would fall between loading the groups and joining the rooms.
//
// At the limit the new connection is rejected with ErrTooManyConnections,
// the oldest one is not evicted. After Close it fails with ErrHubClosed.
func (h *Hub) Register(userID uuid.UUID) (*Client, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.closed {
		return nil, ErrHubClosed
	}
	if len(h.users[userID]) >= h.maxConnsPerUser {
		return nil, ErrTooManyConnections
	}

	c := &Client{
		userID:  userID,
		send:    make(chan []byte, h.sendBuffer),
		done:    make(chan struct{}),
		hub:     h,
		groups:  make(map[uuid.UUID]struct{}),
		loading: true,
	}
	if h.users[userID] == nil {
		h.users[userID] = make(map[*Client]struct{})
	}
	h.users[userID][c] = struct{}{}
	return c, nil
}

// JoinInitialGroups puts c into the groups loaded after Register, except
// those that a LeaveGroup or RemoveGroup hit while loading: the loaded list
// may be older than that change. It ends loading. It does nothing if c is
// gone or not loading.
func (h *Hub) JoinInitialGroups(c *Client, groupIDs []uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if !h.registered(c) || !c.loading {
		return
	}
	for _, groupID := range groupIDs {
		if _, removed := c.removedWhileLoading[groupID]; !removed {
			h.addTo(c, groupID)
		}
	}
	c.loading = false
	c.removedWhileLoading = nil
}

// Unregister removes c from every room and closes its Done channel. It is
// safe to call twice, and after Close.
func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.drop(c, nil)
}

// Broadcast queues msg for every connection in the group's room. It never
// blocks: a connection with a full buffer is dropped (ErrSlowClient) and
// will catch up through REST. msg must not be modified afterwards, the
// connections share it.
func (h *Hub) Broadcast(groupID uuid.UUID, msg []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// enqueue may drop c, which deletes it from this very map. Go allows
	// that while ranging over it.
	for c := range h.rooms[groupID] {
		h.enqueue(c, msg)
	}
}

// SendToUser queues msg for all connections of the user, also those that
// are still loading.
func (h *Hub) SendToUser(userID uuid.UUID, msg []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for c := range h.users[userID] {
		h.enqueue(c, msg)
	}
}

// SendToClient queues msg for one connection, e.g. ready, pong or error.
func (h *Hub) SendToClient(c *Client, msg []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.registered(c) {
		h.enqueue(c, msg)
	}
}

// JoinGroup moves all connections of the user into the group's room.
func (h *Hub) JoinGroup(userID, groupID uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for c := range h.users[userID] {
		h.addTo(c, groupID)
		// Joining after a leave: the join is the newer fact. Deleting from
		// a nil map is a no-op, so this needs no loading check.
		delete(c.removedWhileLoading, groupID)
	}
}

// LeaveGroup takes all connections of the user out of the group's room.
func (h *Hub) LeaveGroup(userID, groupID uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for c := range h.users[userID] {
		h.removeFrom(c, groupID)
		if c.loading {
			markRemoved(c, groupID)
		}
	}
}

// RemoveGroup drops the whole room, because the group was deleted. The hub
// does not know the members, so every loading connection remembers it.
func (h *Hub) RemoveGroup(groupID uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for c := range h.rooms[groupID] {
		delete(c.groups, groupID)
	}
	delete(h.rooms, groupID)

	for _, conns := range h.users {
		for c := range conns {
			if c.loading {
				markRemoved(c, groupID)
			}
		}
	}
}

// Close drops every connection with ErrHubClosed, and later Register calls
// fail. It is meant for srv.RegisterOnShutdown: Shutdown does not close
// hijacked connections such as WebSockets.
func (h *Hub) Close() {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.closed = true
	for _, conns := range h.users {
		for c := range conns {
			h.drop(c, ErrHubClosed)
		}
	}
}

// enqueue queues msg without waiting. A full buffer means the connection
// does not keep up; it is dropped instead of making everyone wait. The
// caller holds mu.
func (h *Hub) enqueue(c *Client, msg []byte) {
	select {
	case c.send <- msg:
	default:
		h.drop(c, ErrSlowClient)
	}
}
