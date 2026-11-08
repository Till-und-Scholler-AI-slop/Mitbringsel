package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"mitbringsel/internal/config"
	"mitbringsel/internal/group"
	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/user"
)

const testInviteToken = "SECRET-TOKEN"

var testInviteID = uuid.MustParse("0190a8c4-0000-7000-8000-0000000000b1")

// fakeInvites returns the configured values for every method and records
// the calls, like fakeGroups.
type fakeInvites struct {
	list    []group.Invite
	preview group.InvitePreview
	err     error

	calls []string
}

func (f *fakeInvites) record(format string, args ...any) {
	f.calls = append(f.calls, fmt.Sprintf(format, args...))
}

func (f *fakeInvites) Create(_ context.Context, actor, groupID uuid.UUID) (string, group.Invite, error) {
	f.record("Create %s %s", actor, groupID)
	if f.err != nil {
		return "", group.Invite{}, f.err
	}
	return testInviteToken, testInvite(), nil
}

func (f *fakeInvites) List(_ context.Context, actor, groupID uuid.UUID) ([]group.Invite, error) {
	f.record("List %s %s", actor, groupID)
	return f.list, f.err
}

func (f *fakeInvites) Revoke(_ context.Context, actor, groupID, inviteID uuid.UUID) error {
	f.record("Revoke %s %s %s", actor, groupID, inviteID)
	return f.err
}

func (f *fakeInvites) Preview(_ context.Context, token string) (group.InvitePreview, error) {
	f.record("Preview %s", token)
	return f.preview, f.err
}

func (f *fakeInvites) Accept(_ context.Context, actor uuid.UUID, token string) (group.Group, error) {
	f.record("Accept %s %s", actor, token)
	if f.err != nil {
		return group.Group{}, f.err
	}
	return group.Group{ID: testGroupID, Name: "WG Kaiserstraße"}, nil
}

func testInvite() group.Invite {
	return group.Invite{
		ID: testInviteID, GroupID: testGroupID,
		CreatedAt: groupTime, ExpiresAt: groupTime.AddDate(0, 0, 7),
		CreatedByName: "Anna Müller",
	}
}

func testPreview() group.InvitePreview {
	return group.InvitePreview{
		GroupName:          "WG Kaiserstraße",
		InvitedBy:          "Anna Müller",
		InvitedByAvatarURL: "https://example.com/anna.png",
		ExpiresAt:          groupTime.AddDate(0, 0, 7),
		MemberCount:        6,
		Members: []group.PreviewMember{
			{FirstName: "Anna", AvatarURL: "https://example.com/anna.png"},
			{FirstName: "Ben"},
		},
	}
}

// inviteRequest sends a request through the real router, with a valid
// session cookie if loggedIn is set.
func inviteRequest(t *testing.T, invites InviteService, loggedIn bool, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	router := NewRouter(Deps{
		Env:      config.EnvDevelopment,
		DB:       fakePinger{},
		Sessions: &fakeSessions{fakeValidator: fakeValidator{validToken: groupToken}},
		Users:    &fakeUsers{users: map[uuid.UUID]user.User{testUserID: testUser()}},
		Invites:  invites,
	})
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if loggedIn {
		req.AddCookie(&http.Cookie{Name: testCookieName, Value: groupToken})
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func groupInvitesPathFor(suffix string) string {
	return groupPathFor("/invites" + suffix)
}

func inviteTokenPath(suffix string) string {
	return "/api/v1/invites/" + testInviteToken + suffix
}

func TestCreateInvite(t *testing.T) {
	invites := &fakeInvites{}

	rec := inviteRequest(t, invites, true, http.MethodPost, groupInvitesPathFor(""), "")

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store: the body holds a secret", got)
	}
	requireUTCTimestamps(t, rec.Body.Bytes())
	var got apigen.InviteCreated
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body %s: %v", rec.Body, err)
	}
	if got.Token != testInviteToken || got.ID != testInviteID {
		t.Errorf("body = %+v, want the token and ID", got)
	}
	if got.CreatedByName == nil || *got.CreatedByName != "Anna Müller" {
		t.Errorf("CreatedByName = %v", got.CreatedByName)
	}
	if want := fmt.Sprintf("Create %s %s", testUserID, testGroupID); len(invites.calls) != 1 || invites.calls[0] != want {
		t.Errorf("calls = %q, want [%q]", invites.calls, want)
	}
}

func TestListInvites(t *testing.T) {
	t.Run("no invites is an empty array, not null", func(t *testing.T) {
		rec := inviteRequest(t, &fakeInvites{}, true, http.MethodGet, groupInvitesPathFor(""), "")

		if got := strings.TrimSpace(rec.Body.String()); rec.Code != http.StatusOK || got != `{"invites":[]}` {
			t.Errorf("status = %d, body = %s", rec.Code, got)
		}
	})

	t.Run("invites without token", func(t *testing.T) {
		anonymous := testInvite()
		anonymous.CreatedByName = ""
		rec := inviteRequest(t, &fakeInvites{list: []group.Invite{testInvite(), anonymous}}, true,
			http.MethodGet, groupInvitesPathFor(""), "")

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d", rec.Code)
		}
		if strings.Contains(strings.ToLower(rec.Body.String()), "token") {
			t.Errorf("list contains a token: %s", rec.Body)
		}
		requireUTCTimestamps(t, rec.Body.Bytes())
		var got apigen.InviteList
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode body %s: %v", rec.Body, err)
		}
		if len(got.Invites) != 2 || got.Invites[0].CreatedByName == nil || got.Invites[1].CreatedByName != nil {
			t.Errorf("invites = %+v, want the second one without creator", got.Invites)
		}
	})
}

func TestRevokeInvite(t *testing.T) {
	invites := &fakeInvites{}

	rec := inviteRequest(t, invites, true, http.MethodDelete, groupInvitesPathFor("/"+testInviteID.String()), "")

	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Errorf("status = %d, body = %q; want 204 and no body", rec.Code, rec.Body)
	}
	if want := fmt.Sprintf("Revoke %s %s %s", testUserID, testGroupID, testInviteID); len(invites.calls) != 1 || invites.calls[0] != want {
		t.Errorf("calls = %q, want [%q]", invites.calls, want)
	}
}

func TestPreviewInvite(t *testing.T) {
	t.Run("works without login and shows the preview", func(t *testing.T) {
		invites := &fakeInvites{preview: testPreview()}

		rec := inviteRequest(t, invites, false, http.MethodGet, inviteTokenPath(""), "")

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Errorf("Cache-Control = %q, want no-store", got)
		}
		requireUTCTimestamps(t, rec.Body.Bytes())
		var got apigen.InvitePreview
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode body %s: %v", rec.Body, err)
		}
		if got.GroupName != "WG Kaiserstraße" || got.MemberCount != 6 || len(got.Members) != 2 {
			t.Errorf("preview = %+v", got)
		}
		if got.InvitedByName == nil || *got.InvitedByName != "Anna Müller" {
			t.Errorf("InvitedByName = %v", got.InvitedByName)
		}
		if got.Members[0].AvatarURL == nil || got.Members[1].AvatarURL != nil {
			t.Errorf("avatars = %v, %v; want the first set, the second null", got.Members[0].AvatarURL, got.Members[1].AvatarURL)
		}
		if want := "Preview " + testInviteToken; len(invites.calls) != 1 || invites.calls[0] != want {
			t.Errorf("calls = %q, want [%q]", invites.calls, want)
		}
	})

	t.Run("the preview exposes no account data", func(t *testing.T) {
		rec := inviteRequest(t, &fakeInvites{preview: testPreview()}, false, http.MethodGet, inviteTokenPath(""), "")

		// Only these keys may appear; a new field in the contract must be
		// a deliberate decision about what a link holder may see.
		var keys map[string]json.RawMessage
		if err := json.Unmarshal(rec.Body.Bytes(), &keys); err != nil {
			t.Fatalf("decode body %s: %v", rec.Body, err)
		}
		want := []string{"groupName", "invitedByName", "invitedByAvatarUrl", "expiresAt", "memberCount", "members"}
		if len(keys) != len(want) {
			t.Errorf("keys = %v, want exactly %v", keys, want)
		}
		for _, key := range want {
			if _, ok := keys[key]; !ok {
				t.Errorf("missing key %q", key)
			}
		}
		if strings.Contains(rec.Body.String(), testUserID.String()) {
			t.Errorf("body contains a user ID: %s", rec.Body)
		}
	})
}

func TestAcceptInvite(t *testing.T) {
	invites := &fakeInvites{}

	rec := inviteRequest(t, invites, true, http.MethodPost, inviteTokenPath("/accept"), "")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body)
	}
	var got apigen.InviteAccepted
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body %s: %v", rec.Body, err)
	}
	if got.GroupID != testGroupID || got.GroupName != "WG Kaiserstraße" {
		t.Errorf("body = %+v", got)
	}
	if want := fmt.Sprintf("Accept %s %s", testUserID, testInviteToken); len(invites.calls) != 1 || invites.calls[0] != want {
		t.Errorf("calls = %q, want [%q]", invites.calls, want)
	}
}

func TestInviteErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"invite not found", fmt.Errorf("find invite: %w", group.ErrInviteNotFound), http.StatusNotFound, "INVITE_NOT_FOUND"},
		{"invite expired", group.ErrInviteExpired, http.StatusGone, "INVITE_EXPIRED"},
		{"too many invites", group.ErrTooManyInvites, http.StatusConflict, "TOO_MANY_INVITES"},
		{"group not found", group.ErrNotFound, http.StatusNotFound, "GROUP_NOT_FOUND"},
		{"forbidden", group.ErrForbidden, http.StatusForbidden, "FORBIDDEN"},
		{"database failure", errors.New("connection refused"), http.StatusInternalServerError, "INTERNAL_ERROR"},
	}
	routes := []struct {
		name     string
		loggedIn bool
		method   string
		path     string
	}{
		{"list", true, http.MethodGet, groupInvitesPathFor("")},
		{"create", true, http.MethodPost, groupInvitesPathFor("")},
		{"revoke", true, http.MethodDelete, groupInvitesPathFor("/" + testInviteID.String())},
		{"preview", false, http.MethodGet, inviteTokenPath("")},
		{"accept", true, http.MethodPost, inviteTokenPath("/accept")},
	}

	for _, route := range routes {
		for _, tt := range tests {
			t.Run(route.name+": "+tt.name, func(t *testing.T) {
				rec := inviteRequest(t, &fakeInvites{err: tt.err}, route.loggedIn, route.method, route.path, "")

				if rec.Code != tt.wantStatus {
					t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
				}
				if got := strings.TrimSpace(rec.Body.String()); got != errorBody(tt.wantCode) {
					t.Errorf("body = %s, want %s", got, errorBody(tt.wantCode))
				}
			})
		}
	}
}

func TestInviteRoutesNeedLogin(t *testing.T) {
	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, groupInvitesPathFor("")},
		{http.MethodPost, groupInvitesPathFor("")},
		{http.MethodDelete, groupInvitesPathFor("/" + testInviteID.String())},
		{http.MethodPost, inviteTokenPath("/accept")},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			invites := &fakeInvites{}

			rec := inviteRequest(t, invites, false, route.method, route.path, "")

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", rec.Code)
			}
			if len(invites.calls) != 0 {
				t.Errorf("service was called: %q", invites.calls)
			}
		})
	}
}

func TestInviteBadRequests(t *testing.T) {
	tests := []struct {
		name string
		path string
		verb string
	}{
		{"group ID is no UUID", groupsPath + "/nope/invites", http.MethodGet},
		{"invite ID is no UUID", groupInvitesPathFor("/nope"), http.MethodDelete},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			invites := &fakeInvites{}

			rec := inviteRequest(t, invites, true, tt.verb, tt.path, "")

			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
			if len(invites.calls) != 0 {
				t.Errorf("service was called: %q", invites.calls)
			}
		})
	}
}

func TestInviteWrongMethod(t *testing.T) {
	tests := []struct {
		path      string
		method    string
		wantAllow string
	}{
		{groupInvitesPathFor(""), http.MethodDelete, "GET, POST"},
		{groupInvitesPathFor("/" + testInviteID.String()), http.MethodGet, "DELETE"},
		{inviteTokenPath(""), http.MethodPost, "GET"},
		{inviteTokenPath("/accept"), http.MethodGet, "POST"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := inviteRequest(t, &fakeInvites{}, true, tt.method, tt.path, "")

			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("status = %d, want 405", rec.Code)
			}
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", got, tt.wantAllow)
			}
		})
	}
}
