package httpapi

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	"tuolino/internal/httpapi/apigen"
	"tuolino/internal/item"
	"tuolino/internal/realtime"
)

// broadcastHub is the part of *realtime.Hub the Broadcaster uses.
type broadcastHub interface {
	Broadcast(groupID uuid.UUID, msg []byte)
	SendToUser(userID uuid.UUID, msg []byte)
	JoinGroup(userID, groupID uuid.UUID)
	LeaveGroup(userID, groupID uuid.UUID)
	RemoveGroup(groupID uuid.UUID)
}

// Broadcaster turns domain events into server messages and hands them to the
// hub. It is safe for concurrent use; it holds no state of its own.
//
// Its methods are named after the domain (Item…, List…, Group…, Member…) and
// satisfy the Publisher interfaces of the item, list and group services. The
// list and group methods live in broadcast_list.go and broadcast_group.go.
type Broadcaster struct {
	hub broadcastHub
}

// NewBroadcaster returns a Broadcaster that sends through hub. It takes the
// concrete hub; the interface is only there so tests can replace it.
func NewBroadcaster(hub *realtime.Hub) *Broadcaster {
	return &Broadcaster{hub: hub}
}

// A compile-time check: if the methods of Broadcaster and item.Publisher
// drift apart, the build fails here and not at the call in main.
var _ item.Publisher = (*Broadcaster)(nil)

// ItemChanged tells the group that an item was created or changed. The actor
// is included: the browser that made the change drops the event, because the
// serverSeq of its REST answer is already the same.
func (b *Broadcaster) ItemChanged(ctx context.Context, groupID, actor uuid.UUID, it item.Item) {
	b.broadcast(ctx, groupID, apigen.ItemChangedMessage{
		Type: apigen.ItemChangedMessageTypeItemChanged,
		Payload: apigen.ItemChangedPayload{
			ActorID: actor,
			GroupID: groupID,
			Item:    newItemResponse(it),
		},
	})
}

// ItemDeleted tells the group that an item was deleted. it is the tombstone.
func (b *Broadcaster) ItemDeleted(ctx context.Context, groupID, actor uuid.UUID, it item.Item) {
	b.broadcast(ctx, groupID, apigen.ItemDeletedMessage{
		Type: apigen.ItemDeletedMessageTypeItemDeleted,
		Payload: apigen.ItemDeletedPayload{
			ActorID:   actor,
			GroupID:   groupID,
			ItemID:    it.ID,
			ListID:    it.ListID,
			ServerSeq: it.ServerSeq,
		},
	})
}

// ItemsDeleted tells the group that several items of one list were deleted
// at once, in one message: the client handles each like an itemDeleted.
func (b *Broadcaster) ItemsDeleted(ctx context.Context, groupID, listID, actor uuid.UUID, tombstones []item.Item) {
	deleted := make([]apigen.DeletedItem, len(tombstones))
	for i, it := range tombstones {
		deleted[i] = apigen.DeletedItem{ItemID: it.ID, ServerSeq: it.ServerSeq}
	}
	b.broadcast(ctx, groupID, apigen.ItemsDeletedMessage{
		Type: apigen.ItemsDeletedMessageTypeItemsDeleted,
		Payload: apigen.ItemsDeletedPayload{
			ActorID: actor,
			GroupID: groupID,
			ListID:  listID,
			Items:   deleted,
		},
	})
}

// broadcast encodes msg and queues it for the room of the group. A message
// that cannot be encoded is logged and dropped: the change is stored, and
// clients catch up on their next reload. ctx only carries the request's log
// attributes; the hub never blocks, so nothing waits on it.
func (b *Broadcaster) broadcast(ctx context.Context, groupID uuid.UUID, msg any) {
	if data, ok := encode(ctx, msg, "group", groupID); ok {
		b.hub.Broadcast(groupID, data)
	}
}

// sendToUser encodes msg and queues it for every connection of the user,
// whatever rooms they are in. Failures are handled like in broadcast.
func (b *Broadcaster) sendToUser(ctx context.Context, userID uuid.UUID, msg any) {
	if data, ok := encode(ctx, msg, "user", userID); ok {
		b.hub.SendToUser(userID, data)
	}
}

// encode turns msg into the bytes for the wire with marshalMessage. It logs
// and reports false if that fails, so the callers can drop the message.
// attrs are extra log attributes (key, value, ...) for the failure.
func encode(ctx context.Context, msg any, attrs ...any) ([]byte, bool) {
	data, err := marshalMessage(msg)
	if err != nil {
		slog.ErrorContext(ctx, "websocket: marshal broadcast", append(attrs, "error", err)...)
		return nil, false
	}
	return data, true
}
