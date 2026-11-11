package httpapi

import (
	"context"
	"slices"
	"testing"
)

// requireCalls checks the hub calls in order.
func requireCalls(t *testing.T, hub *fakeHub, want ...string) {
	t.Helper()
	if !slices.Equal(hub.calls, want) {
		t.Errorf("hub calls = %v, want %v", hub.calls, want)
	}
}

func TestBroadcaster_GroupChanged(t *testing.T) {
	hub := &fakeHub{}
	b := &Broadcaster{hub: hub}

	b.GroupChanged(context.Background(), testGroupID, testMemberID)

	requireCalls(t, hub, "Broadcast "+testGroupID.String())
	_, top, payload := requireOneBroadcast(t, hub)
	requireKeys(t, "message", top, "type", "payload")
	requireKeys(t, "payload", payload, "actorId", "groupId")
	requireString(t, "type", top["type"], "groupChanged")
	requireString(t, "actorId", payload["actorId"], testMemberID.String())
	requireString(t, "groupId", payload["groupId"], testGroupID.String())
}

func TestBroadcaster_MemberJoined(t *testing.T) {
	hub := &fakeHub{}
	b := &Broadcaster{hub: hub}

	b.MemberJoined(context.Background(), testGroupID, testMemberID)

	// Join first, so the new member's connections get the broadcast, too.
	requireCalls(t, hub,
		"JoinGroup "+testMemberID.String()+" "+testGroupID.String(),
		"Broadcast "+testGroupID.String())
	_, top, payload := requireOneBroadcast(t, hub)
	requireString(t, "type", top["type"], "groupChanged")
	requireString(t, "actorId", payload["actorId"], testMemberID.String())
	requireString(t, "groupId", payload["groupId"], testGroupID.String())
}

func TestBroadcaster_MemberRemoved(t *testing.T) {
	hub := &fakeHub{}
	b := &Broadcaster{hub: hub}

	b.MemberRemoved(context.Background(), testGroupID, testUserID, testMemberID)

	// Leave first, so the removed user gets groupRemoved only and not the
	// groupChanged for the others.
	requireCalls(t, hub,
		"LeaveGroup "+testMemberID.String()+" "+testGroupID.String(),
		"SendToUser "+testMemberID.String(),
		"Broadcast "+testGroupID.String())

	if len(hub.toUser) != 1 || hub.toUser[0].userID != testMemberID {
		t.Fatalf("messages to users = %+v, want one for the removed user", hub.toUser)
	}
	top, payload := decodeMessage(t, hub.toUser[0].msg)
	requireKeys(t, "message", top, "type", "payload")
	requireKeys(t, "payload", payload, "actorId", "groupId", "reason")
	requireString(t, "type", top["type"], "groupRemoved")
	requireString(t, "actorId", payload["actorId"], testUserID.String())
	requireString(t, "groupId", payload["groupId"], testGroupID.String())
	requireString(t, "reason", payload["reason"], "removed")

	// The others learn from the actor.
	_, top, payload = requireOneBroadcast(t, hub)
	requireString(t, "broadcast type", top["type"], "groupChanged")
	requireString(t, "broadcast actorId", payload["actorId"], testUserID.String())
}

func TestBroadcaster_MemberRemoved_leaving(t *testing.T) {
	hub := &fakeHub{}
	b := &Broadcaster{hub: hub}

	b.MemberRemoved(context.Background(), testGroupID, testMemberID, testMemberID)

	_, payload := decodeMessage(t, hub.toUser[0].msg)
	requireString(t, "reason", payload["reason"], "removed")
	requireString(t, "actorId", payload["actorId"], testMemberID.String())
}

func TestBroadcaster_GroupDeleted(t *testing.T) {
	hub := &fakeHub{}
	b := &Broadcaster{hub: hub}

	b.GroupDeleted(context.Background(), testGroupID, testUserID)

	// Broadcast first: dropping the room first would tell nobody.
	requireCalls(t, hub, "Broadcast "+testGroupID.String(), "RemoveGroup "+testGroupID.String())
	_, top, payload := requireOneBroadcast(t, hub)
	requireKeys(t, "payload", payload, "actorId", "groupId", "reason")
	requireString(t, "type", top["type"], "groupRemoved")
	requireString(t, "actorId", payload["actorId"], testUserID.String())
	requireString(t, "groupId", payload["groupId"], testGroupID.String())
	requireString(t, "reason", payload["reason"], "deleted")
}
