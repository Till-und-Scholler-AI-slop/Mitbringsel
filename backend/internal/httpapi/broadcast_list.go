package httpapi

import (
	"context"

	"github.com/google/uuid"

	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/list"
)

var _ list.Publisher = (*Broadcaster)(nil)

// ListChanged tells the group that a list was created, renamed, archived or
// unarchived. The message carries the whole list, so a client can show it
// without asking again.
func (b *Broadcaster) ListChanged(ctx context.Context, actor uuid.UUID, l list.List) {
	b.broadcast(ctx, l.GroupID, apigen.ListChangedMessage{
		Type: apigen.ListChangedMessageTypeListChanged,
		Payload: apigen.ListChangedPayload{
			ActorID: actor,
			List:    newListResponse(l),
		},
	})
}

// ListDeleted tells the group that a list is gone together with its items.
// l is the list as it was before the deletion.
func (b *Broadcaster) ListDeleted(ctx context.Context, actor uuid.UUID, l list.List) {
	b.broadcast(ctx, l.GroupID, apigen.ListDeletedMessage{
		Type: apigen.ListDeletedMessageTypeListDeleted,
		Payload: apigen.ListDeletedPayload{
			ActorID: actor,
			GroupID: l.GroupID,
			ListID:  l.ID,
		},
	})
}
