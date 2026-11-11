package httpapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

func TestBroadcaster_ListChanged(t *testing.T) {
	hub := &fakeHub{}
	b := &Broadcaster{hub: hub}
	l := testList()
	l.ServerSeq = 77
	archivedAt := listTime.Add(time.Hour)
	l.ArchivedAt = &archivedAt

	b.ListChanged(context.Background(), testMemberID, l)

	// The room is the list's group; the group is not repeated in the payload.
	raw, top, payload := requireOneBroadcast(t, hub)
	requireKeys(t, "message", top, "type", "payload")
	requireKeys(t, "payload", payload, "actorId", "list")
	requireString(t, "type", top["type"], "listChanged")
	requireString(t, "actorId", payload["actorId"], testMemberID.String())

	var got struct {
		ID         string  `json:"id"`
		GroupID    string  `json:"groupId"`
		Name       string  `json:"name"`
		ArchivedAt *string `json:"archivedAt"`
		ServerSeq  int64   `json:"serverSeq"`
	}
	if err := json.Unmarshal(payload["list"], &got); err != nil {
		t.Fatalf("list %s: %v", payload["list"], err)
	}
	if got.ID != testListID.String() || got.GroupID != testGroupID.String() || got.Name != l.Name {
		t.Errorf("list = %+v, want the list passed in", got)
	}
	if got.ServerSeq != 77 {
		t.Errorf("list.serverSeq = %d, want 77", got.ServerSeq)
	}
	if got.ArchivedAt == nil {
		t.Error("list.archivedAt is null, want the archive time")
	}
	requireUTCTimestamps(t, raw)
}

func TestBroadcaster_ListDeleted(t *testing.T) {
	hub := &fakeHub{}
	b := &Broadcaster{hub: hub}

	b.ListDeleted(context.Background(), testMemberID, testList())

	_, top, payload := requireOneBroadcast(t, hub)
	requireKeys(t, "message", top, "type", "payload")
	requireKeys(t, "payload", payload, "actorId", "groupId", "listId")
	requireString(t, "type", top["type"], "listDeleted")
	requireString(t, "actorId", payload["actorId"], testMemberID.String())
	requireString(t, "groupId", payload["groupId"], testGroupID.String())
	requireString(t, "listId", payload["listId"], testListID.String())
}
