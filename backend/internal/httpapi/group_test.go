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
	"time"

	"github.com/google/uuid"

	"mitbringsel/internal/config"
	"mitbringsel/internal/group"
	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/user"
)

const groupToken = "GROUP-TOKEN"

var (
	testGroupID  = uuid.MustParse("0190a8c4-0000-7000-8000-0000000000a1")
	testMemberID = uuid.MustParse("0190a8c4-0000-7000-8000-000000000002")
	groupTime    = time.Date(2026, time.March, 1, 10, 0, 0, 0, testZone)
)

// fakeGroups returns the configured details or error for every method and
// records the last call, so tests can check what the handler passed on.
type fakeGroups struct {
	details []group.Details
	err     error

	// calls lists the methods that were called, with their arguments.
	calls []string
}

func (f *fakeGroups) record(format string, args ...any) {
	f.calls = append(f.calls, fmt.Sprintf(format, args...))
}

func (f *fakeGroups) first() (group.Details, error) {
	if f.err != nil {
		return group.Details{}, f.err
	}
	return f.details[0], nil
}

func (f *fakeGroups) Create(_ context.Context, actor uuid.UUID, name string) (group.Details, error) {
	f.record("Create %s %q", actor, name)
	return f.first()
}

func (f *fakeGroups) List(_ context.Context, actor uuid.UUID) ([]group.Details, error) {
	f.record("List %s", actor)
	return f.details, f.err
}

func (f *fakeGroups) Get(_ context.Context, actor, groupID uuid.UUID) (group.Details, error) {
	f.record("Get %s %s", actor, groupID)
	return f.first()
}

func (f *fakeGroups) Rename(_ context.Context, actor, groupID uuid.UUID, name string) (group.Group, error) {
	f.record("Rename %s %s %q", actor, groupID, name)
	return group.Group{}, f.err
}

func (f *fakeGroups) Delete(_ context.Context, actor, groupID uuid.UUID) error {
	f.record("Delete %s %s", actor, groupID)
	return f.err
}

func (f *fakeGroups) RemoveMember(_ context.Context, actor, groupID, userID uuid.UUID) error {
	f.record("RemoveMember %s %s %s", actor, groupID, userID)
	return f.err
}

func (f *fakeGroups) SetRole(_ context.Context, actor, groupID, userID uuid.UUID, role group.Role) error {
	f.record("SetRole %s %s %s %s", actor, groupID, userID, role)
	return f.err
}

// GroupIDs serves the live connection, which runs on goroutines of its own.
// It therefore only reads and records no call: the calls slice has no lock.
func (f *fakeGroups) GroupIDs(_ context.Context, _ uuid.UUID) ([]uuid.UUID, error) {
	if f.err != nil {
		return nil, f.err
	}
	ids := make([]uuid.UUID, len(f.details))
	for i, d := range f.details {
		ids[i] = d.ID
	}
	return ids, nil
}

func testDetails() group.Details {
	return group.Details{
		Group: group.Group{ID: testGroupID, Name: "WG Kaiserstraße", CreatedAt: groupTime, UpdatedAt: groupTime},
		Role:  group.RoleAdmin,
		Members: []group.Member{
			{UserID: testUserID, DisplayName: "Anna", AvatarURL: "https://example.com/a.png", Role: group.RoleAdmin, JoinedAt: groupTime},
			{UserID: testMemberID, DisplayName: "Ben", Role: group.RoleMember, JoinedAt: groupTime},
		},
	}
}

// groupRequest sends a request through the real router with a valid
// session cookie, so routing, requireUser and the handler run together.
func groupRequest(t *testing.T, groups GroupService, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	router := NewRouter(Deps{
		Env:      config.EnvDevelopment,
		DB:       fakePinger{},
		Sessions: &fakeSessions{fakeValidator: fakeValidator{validToken: groupToken}},
		Users:    &fakeUsers{users: map[uuid.UUID]user.User{testUserID: testUser()}},
		Groups:   groups,
	})
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: testCookieName, Value: groupToken})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func groupPathFor(suffix string) string {
	return groupsPath + "/" + testGroupID.String() + suffix
}

func memberPathFor(suffix string) string {
	return groupPathFor("/members/" + testMemberID.String() + suffix)
}

func errorBody(code string) string {
	return fmt.Sprintf(`{"error":{"code":%q}}`, code)
}

func TestGroupResponses(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		wantStatus int
		// wantCalls are the service calls in order.
		wantCalls []string
	}{
		{
			name: "get", method: http.MethodGet, path: groupPathFor(""),
			wantStatus: http.StatusOK,
			wantCalls:  []string{fmt.Sprintf("Get %s %s", testUserID, testGroupID)},
		},
		{
			name: "create", method: http.MethodPost, path: groupsPath, body: `{"name":"WG Kaiserstraße"}`,
			wantStatus: http.StatusCreated,
			wantCalls:  []string{fmt.Sprintf("Create %s %q", testUserID, "WG Kaiserstraße")},
		},
		{
			// The response must carry the members like any group, so the
			// handler loads the group again after renaming it.
			name: "rename", method: http.MethodPatch, path: groupPathFor(""), body: `{"name":"Zuhause"}`,
			wantStatus: http.StatusOK,
			wantCalls: []string{
				fmt.Sprintf("Rename %s %s %q", testUserID, testGroupID, "Zuhause"),
				fmt.Sprintf("Get %s %s", testUserID, testGroupID),
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			groups := &fakeGroups{details: []group.Details{testDetails()}}

			rec := groupRequest(t, groups, tt.method, tt.path, tt.body)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tt.wantStatus, rec.Body)
			}
			if strings.Join(groups.calls, "|") != strings.Join(tt.wantCalls, "|") {
				t.Errorf("calls = %q, want %q", groups.calls, tt.wantCalls)
			}
			requireUTCTimestamps(t, rec.Body.Bytes())
			var got apigen.Group
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode body %s: %v", rec.Body, err)
			}
			if got.ID != testGroupID || got.Name != "WG Kaiserstraße" || got.Role != apigen.Role(group.RoleAdmin) {
				t.Errorf("group = %+v", got)
			}
			if len(got.Members) != 2 {
				t.Fatalf("members = %+v, want 2", got.Members)
			}
			if got.Members[0].AvatarURL == nil || *got.Members[0].AvatarURL != "https://example.com/a.png" {
				t.Errorf("avatar of first member = %v", got.Members[0].AvatarURL)
			}
			if got.Members[1].AvatarURL != nil {
				t.Errorf("member without avatar has avatar %q", *got.Members[1].AvatarURL)
			}
		})
	}
}

func TestListGroups(t *testing.T) {
	t.Run("no groups is an empty array, not null", func(t *testing.T) {
		rec := groupRequest(t, &fakeGroups{}, http.MethodGet, groupsPath, "")

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d", rec.Code)
		}
		if got := strings.TrimSpace(rec.Body.String()); got != `{"groups":[]}` {
			t.Errorf("body = %s", got)
		}
	})

	t.Run("groups of the user", func(t *testing.T) {
		groups := &fakeGroups{details: []group.Details{testDetails()}}

		rec := groupRequest(t, groups, http.MethodGet, groupsPath, "")

		requireUTCTimestamps(t, rec.Body.Bytes())
		var got apigen.GroupList
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode body %s: %v", rec.Body, err)
		}
		if len(got.Groups) != 1 || got.Groups[0].Name != "WG Kaiserstraße" {
			t.Errorf("groups = %+v", got.Groups)
		}
		if want := "List " + testUserID.String(); len(groups.calls) != 1 || groups.calls[0] != want {
			t.Errorf("calls = %q, want [%q]", groups.calls, want)
		}
	})
}

func TestGroupSuccessWithoutBody(t *testing.T) {
	tests := []struct {
		name     string
		method   string
		path     string
		body     string
		wantCall string
	}{
		{
			name: "delete group", method: http.MethodDelete, path: groupPathFor(""),
			wantCall: fmt.Sprintf("Delete %s %s", testUserID, testGroupID),
		},
		{
			name: "remove member", method: http.MethodDelete, path: memberPathFor(""),
			wantCall: fmt.Sprintf("RemoveMember %s %s %s", testUserID, testGroupID, testMemberID),
		},
		{
			name: "set role", method: http.MethodPut, path: memberPathFor("/role"), body: `{"role":"admin"}`,
			wantCall: fmt.Sprintf("SetRole %s %s %s admin", testUserID, testGroupID, testMemberID),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			groups := &fakeGroups{}

			rec := groupRequest(t, groups, tt.method, tt.path, tt.body)

			if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
				t.Errorf("status = %d, body = %q; want 204 and no body", rec.Code, rec.Body)
			}
			if len(groups.calls) != 1 || groups.calls[0] != tt.wantCall {
				t.Errorf("calls = %q, want [%q]", groups.calls, tt.wantCall)
			}
		})
	}
}

// TestGroupErrors checks the mapping of domain errors on one route per
// operation; the mapping itself is shared by all handlers.
func TestGroupErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"not found", fmt.Errorf("get group: %w", group.ErrNotFound), http.StatusNotFound, "GROUP_NOT_FOUND"},
		{"forbidden", group.ErrForbidden, http.StatusForbidden, "FORBIDDEN"},
		{"invalid name", fmt.Errorf("%w: name is empty", group.ErrInvalidName), http.StatusBadRequest, "GROUP_NAME_INVALID"},
		{"invalid role", group.ErrInvalidRole, http.StatusBadRequest, "INVALID_ROLE"},
		{"owner immutable", group.ErrOwnerImmutable, http.StatusConflict, "OWNER_IMMUTABLE"},
		{"too many groups", group.ErrTooManyGroups, http.StatusConflict, "TOO_MANY_GROUPS"},
		{"database failure", errors.New("connection refused"), http.StatusInternalServerError, "INTERNAL_ERROR"},
	}
	routes := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"list", http.MethodGet, groupsPath, ""},
		{"create", http.MethodPost, groupsPath, `{"name":"x"}`},
		{"get", http.MethodGet, groupPathFor(""), ""},
		{"rename", http.MethodPatch, groupPathFor(""), `{"name":"x"}`},
		{"delete", http.MethodDelete, groupPathFor(""), ""},
		{"remove member", http.MethodDelete, memberPathFor(""), ""},
		{"set role", http.MethodPut, memberPathFor("/role"), `{"role":"admin"}`},
	}

	for _, route := range routes {
		for _, tt := range tests {
			t.Run(route.name+": "+tt.name, func(t *testing.T) {
				rec := groupRequest(t, &fakeGroups{err: tt.err}, route.method, route.path, route.body)

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

func TestGroupBadRequests(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"group ID is no UUID", http.MethodGet, groupsPath + "/nope", ""},
		{"user ID is no UUID", http.MethodDelete, groupPathFor("/members/nope"), ""},
		{"create without JSON", http.MethodPost, groupsPath, "name=x"},
		{"create without body", http.MethodPost, groupsPath, ""},
		{"rename with broken JSON", http.MethodPatch, groupPathFor(""), `{"name":`},
		{"set role with oversized body", http.MethodPut, memberPathFor("/role"),
			`{"role":"` + strings.Repeat("a", maxGroupBodyBytes) + `"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			groups := &fakeGroups{}

			rec := groupRequest(t, groups, tt.method, tt.path, tt.body)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != errorBody("INVALID_REQUEST") {
				t.Errorf("body = %s", got)
			}
			if len(groups.calls) != 0 {
				t.Errorf("service was called: %q", groups.calls)
			}
		})
	}
}

func TestGroupRoutesNeedLogin(t *testing.T) {
	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, groupsPath},
		{http.MethodPost, groupsPath},
		{http.MethodGet, groupPathFor("")},
		{http.MethodPatch, groupPathFor("")},
		{http.MethodDelete, groupPathFor("")},
		{http.MethodDelete, memberPathFor("")},
		{http.MethodPut, memberPathFor("/role")},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			groups := &fakeGroups{}
			router := NewRouter(Deps{
				Env:      config.EnvDevelopment,
				DB:       fakePinger{},
				Sessions: &fakeSessions{fakeValidator: fakeValidator{validToken: groupToken}},
				Users:    &fakeUsers{},
				Groups:   groups,
			})
			// No session cookie.
			req := httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`))
			rec := httptest.NewRecorder()

			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", rec.Code)
			}
			if len(groups.calls) != 0 {
				t.Errorf("service was called: %q", groups.calls)
			}
		})
	}
}

func TestGroupWrongMethod(t *testing.T) {
	tests := []struct {
		path      string
		method    string
		wantAllow string
	}{
		{groupsPath, http.MethodDelete, "GET, POST"},
		{groupPathFor(""), http.MethodPost, "GET, PATCH, DELETE"},
		{memberPathFor(""), http.MethodGet, "DELETE"},
		{memberPathFor("/role"), http.MethodPost, "PUT"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := groupRequest(t, &fakeGroups{}, tt.method, tt.path, "")

			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("status = %d, want 405", rec.Code)
			}
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", got, tt.wantAllow)
			}
		})
	}

	t.Run("unknown path below a group stays 404", func(t *testing.T) {
		rec := groupRequest(t, &fakeGroups{}, http.MethodGet, groupPathFor("/unknown"), "")

		if rec.Code != http.StatusNotFound {
			t.Errorf("status = %d, want 404", rec.Code)
		}
	})
}

func TestMatchesPattern(t *testing.T) {
	tests := []struct {
		pattern string
		path    string
		want    bool
	}{
		{"/api/v1/me", "/api/v1/me", true},
		{"/api/v1/me", "/api/v1/you", false},
		{"/api/v1/groups/{groupId}", "/api/v1/groups/abc", true},
		{"/api/v1/groups/{groupId}", "/api/v1/groups/", false},
		{"/api/v1/groups/{groupId}", "/api/v1/groups/abc/members", false},
		{"/api/v1/groups/{groupId}/members/{userId}", "/api/v1/groups/a/members/b", true},
		{"/api/v1/groups/{groupId}/members/{userId}", "/api/v1/groups/a/people/b", false},
	}

	for _, tt := range tests {
		if got := matchesPattern(tt.pattern, tt.path); got != tt.want {
			t.Errorf("matchesPattern(%q, %q) = %v, want %v", tt.pattern, tt.path, got, tt.want)
		}
	}
}
