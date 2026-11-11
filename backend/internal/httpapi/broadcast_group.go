package httpapi

import (
	"context"

	"github.com/google/uuid"

	"mitbringsel/internal/group"
	"mitbringsel/internal/httpapi/apigen"
)

var _ group.Publisher = (*Broadcaster)(nil)

// The room calls (JoinGroup, LeaveGroup, RemoveGroup) always run, also if a
// message cannot be encoded: who receives events must not depend on that.

// GroupChanged tells the group that its name or a role changed. The message
// is only a hint to reload the groups.
func (b *Broadcaster) GroupChanged(ctx context.Context, groupID, actor uuid.UUID) {
	b.broadcast(ctx, groupID, groupChangedMessage(groupID, actor))
}

// MemberJoined moves the connections of the new member into the room of the
// group, and then tells the room. The order matters: the new member's own
// connections get the hint, too, and reload the groups.
func (b *Broadcaster) MemberJoined(ctx context.Context, groupID, userID uuid.UUID) {
	b.hub.JoinGroup(userID, groupID)
	b.broadcast(ctx, groupID, groupChangedMessage(groupID, userID))
}

// MemberRemoved takes the connections of the removed member out of the room
// first, then tells them, and then tells the remaining members. The order
// matters: with the room left first, the removed user gets groupRemoved and
// not the groupChanged that is meant for the others.
func (b *Broadcaster) MemberRemoved(ctx context.Context, groupID, actor, userID uuid.UUID) {
	b.hub.LeaveGroup(userID, groupID)
	b.sendToUser(ctx, userID, apigen.GroupRemovedMessage{
		Type: apigen.GroupRemovedMessageTypeGroupRemoved,
		Payload: apigen.GroupRemovedPayload{
			ActorID: actor,
			GroupID: groupID,
			Reason:  apigen.GroupRemovedReasonRemoved,
		},
	})
	b.broadcast(ctx, groupID, groupChangedMessage(groupID, actor))
}

// GroupDeleted tells the room that the group is gone, and then drops the
// room. The other order would tell nobody.
func (b *Broadcaster) GroupDeleted(ctx context.Context, groupID, actor uuid.UUID) {
	b.broadcast(ctx, groupID, apigen.GroupRemovedMessage{
		Type: apigen.GroupRemovedMessageTypeGroupRemoved,
		Payload: apigen.GroupRemovedPayload{
			ActorID: actor,
			GroupID: groupID,
			Reason:  apigen.GroupRemovedReasonDeleted,
		},
	})
	b.hub.RemoveGroup(groupID)
}

func groupChangedMessage(groupID, actor uuid.UUID) apigen.GroupChangedMessage {
	return apigen.GroupChangedMessage{
		Type: apigen.GroupChangedMessageTypeGroupChanged,
		Payload: apigen.GroupChangedPayload{
			ActorID: actor,
			GroupID: groupID,
		},
	}
}
