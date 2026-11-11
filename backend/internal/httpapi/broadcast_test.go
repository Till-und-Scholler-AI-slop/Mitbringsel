package httpapi

import (
	"context"
	"encoding/json"
	"math"
	"slices"
	"testing"

	"github.com/google/uuid"
)

// fakeHub records what the Broadcaster hands over.
type fakeHub struct {
	sent []sentMessage
}

type sentMessage struct {
	groupID uuid.UUID
	msg     []byte
}

func (h *fakeHub) Broadcast(groupID uuid.UUID, msg []byte) {
	h.sent = append(h.sent, sentMessage{groupID, msg})
}

// requireOneBroadcast checks that exactly one message went to the group and
// returns it decoded one level deep.
func requireOneBroadcast(t *testing.T, hub *fakeHub) (raw []byte, top, payload map[string]json.RawMessage) {
	t.Helper()
	if len(hub.sent) != 1 {
		t.Fatalf("broadcast %d messages, want 1", len(hub.sent))
	}
	if hub.sent[0].groupID != testGroupID {
		t.Errorf("group = %s, want %s", hub.sent[0].groupID, testGroupID)
	}
	raw = hub.sent[0].msg
	if err := json.Unmarshal(raw, &top); err != nil {
		t.Fatalf("message %s is not JSON: %v", raw, err)
	}
	if err := json.Unmarshal(top["payload"], &payload); err != nil {
		t.Fatalf("payload %s is not an object: %v", top["payload"], err)
	}
	return raw, top, payload
}

// requireKeys checks the exact set of keys of a JSON object.
func requireKeys(t *testing.T, what string, got map[string]json.RawMessage, want ...string) {
	t.Helper()
	keys := make([]string, 0, len(got))
	for k := range got {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	slices.Sort(want)
	if !slices.Equal(keys, want) {
		t.Errorf("%s keys = %v, want %v", what, keys, want)
	}
}

func requireString(t *testing.T, what string, raw json.RawMessage, want string) {
	t.Helper()
	var got string
	if err := json.Unmarshal(raw, &got); err != nil || got != want {
		t.Errorf("%s = %s, want %q", what, raw, want)
	}
}

func TestBroadcaster_ItemChanged(t *testing.T) {
	hub := &fakeHub{}
	b := &Broadcaster{hub: hub}
	it := testItem()

	b.ItemChanged(context.Background(), testGroupID, testMemberID, it)

	raw, top, payload := requireOneBroadcast(t, hub)
	requireKeys(t, "message", top, "type", "payload")
	requireKeys(t, "payload", payload, "actorId", "groupId", "item")
	requireString(t, "type", top["type"], "itemChanged")
	requireString(t, "actorId", payload["actorId"], testMemberID.String())
	requireString(t, "groupId", payload["groupId"], testGroupID.String())

	var got struct {
		ServerSeq int64             `json:"serverSeq"`
		Clocks    map[string]string `json:"clocks"`
	}
	if err := json.Unmarshal(payload["item"], &got); err != nil {
		t.Fatalf("item %s: %v", payload["item"], err)
	}
	if got.ServerSeq != it.ServerSeq {
		t.Errorf("item.serverSeq = %d, want %d", got.ServerSeq, it.ServerSeq)
	}
	if got.Clocks["name"] != "0000019a2b3c4d5e-0000-anna" || got.Clocks["checked"] != "0000019a2b3c4d62-0000-ben" {
		t.Errorf("item.clocks = %v", got.Clocks)
	}
	requireUTCTimestamps(t, raw)
}

func TestBroadcaster_ItemDeleted(t *testing.T) {
	hub := &fakeHub{}
	b := &Broadcaster{hub: hub}
	tombstone := testItem()
	tombstone.ServerSeq = 43

	b.ItemDeleted(context.Background(), testGroupID, testMemberID, tombstone)

	_, top, payload := requireOneBroadcast(t, hub)
	requireKeys(t, "message", top, "type", "payload")
	requireKeys(t, "payload", payload, "actorId", "groupId", "listId", "itemId", "serverSeq")
	requireString(t, "type", top["type"], "itemDeleted")
	requireString(t, "actorId", payload["actorId"], testMemberID.String())
	requireString(t, "groupId", payload["groupId"], testGroupID.String())
	requireString(t, "listId", payload["listId"], testListID.String())
	requireString(t, "itemId", payload["itemId"], testItemID.String())
	if got := string(payload["serverSeq"]); got != "43" {
		t.Errorf("serverSeq = %s, want 43", got)
	}
}

func TestBroadcaster_dropsUnencodableMessage(t *testing.T) {
	hub := &fakeHub{}
	b := &Broadcaster{hub: hub}
	it := testItem()
	// encoding/json refuses NaN, so the message cannot be built.
	it.Quantity = ptr(math.NaN())

	b.ItemChanged(context.Background(), testGroupID, testMemberID, it)

	if len(hub.sent) != 0 {
		t.Errorf("broadcast %d messages, want none", len(hub.sent))
	}
}
