package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"mitbringsel/internal/group"
	"mitbringsel/internal/httpapi/apigen"
)

const groupsToken = "VALID-TOKEN"

var (
	testGroupID = uuid.MustParse("0190a8c4-0000-7000-8000-0000000000a1")
	otherUserID = uuid.MustParse("0190a8c4-0000-7000-8000-000000000002")

	testJoinedFirst  = time.Date(2026, time.January, 15, 12, 0, 0, 0, time.UTC)
	testJoinedSecond = time.Date(2026, time.January, 16, 9, 30, 0, 0, time.UTC)
)

// testGroupJSON is testGroupDetails as the API contract writes it. Spelled
// out on purpose: a renamed or missing field in a response shows up here.
const testGroupJSON = `{"createdAt":"2026-01-15T12:00:00Z","id":"0190a8c4-0000-7000-8000-0000000000a1",` +
	`"members":[` +
	`{"avatarUrl":"https://example.com/anna.png","displayName":"Anna Müller","joinedAt":"2026-01-15T12:00:00Z",` +
	`"role":"owner","userId":"0190a8c4-0000-7000-8000-000000000001"},` +
	`{"avatarUrl":null,"displayName":"Ben","joinedAt":"2026-01-16T09:30:00Z",` +
	`"role":"member","userId":"0190a8c4-0000-7000-8000-000000000002"}],` +
	`"name":"WG Kaiserstraße","role":"owner","updatedAt":"2026-01-16T09:30:00Z"}`

func testGroupDetails() group.Details {
	return group.Details{
		Group: group.Group{
			ID:        testGroupID,
			Name:      "WG Kaiserstraße",
			CreatedAt: testJoinedFirst,
			UpdatedAt: testJoinedSecond,
		},
		Role: group.RoleOwner,
		Members: []group.Member{
			{
				UserID:      testUserID,
				DisplayName: "Anna Müller",
				AvatarURL:   "https://example.com/anna.png",
				Role:        group.RoleOwner,
				JoinedAt:    testJoinedFirst,
			},
			{UserID: otherUserID, DisplayName: "Ben", Role: group.RoleMember, JoinedAt: testJoinedSecond},
		},
	}
}

// fakeGroups stands in for *group.Service. Like the real service, it wraps
// group.ErrNotFound for a group the user is not in, so the handlers see the
// same errors in the test as in production.
type fakeGroups struct {
	// list is returned by List, details by Get (keyed by group ID).
	list    []group.Details
	details map[uuid.UUID]group.Details
	// created is returned by Create, renamed by Rename.
	created group.Details
	renamed group.Details
	// err, if set, is returned by every method.
	err error

	// What the service was called with.
	calls      int
	gotActor   uuid.UUID
	gotGroupID uuid.UUID
	gotUserID  uuid.UUID
	gotName    string
	gotRole    group.Role
}

func (f *fakeGroups) Rename(_ context.Context, actor, groupID uuid.UUID, name string) (group.Details, error) {
	f.calls++
	f.gotActor, f.gotGroupID, f.gotName = actor, groupID, name
	if f.err != nil {
		return group.Details{}, f.err
	}
	return f.renamed, nil
}

func (f *fakeGroups) Delete(_ context.Context, actor, groupID uuid.UUID) error {
	f.calls++
	f.gotActor, f.gotGroupID = actor, groupID
	return f.err
}

func (f *fakeGroups) SetRole(_ context.Context, actor, groupID, userID uuid.UUID, role group.Role) error {
	f.calls++
	f.gotActor, f.gotGroupID, f.gotUserID, f.gotRole = actor, groupID, userID, role
	return f.err
}

func (f *fakeGroups) RemoveMember(_ context.Context, actor, groupID, userID uuid.UUID) error {
	f.calls++
	f.gotActor, f.gotGroupID, f.gotUserID = actor, groupID, userID
	return f.err
}

func (f *fakeGroups) List(_ context.Context, actor uuid.UUID) ([]group.Details, error) {
	f.calls++
	f.gotActor = actor
	if f.err != nil {
		return nil, f.err
	}
	return f.list, nil
}

func (f *fakeGroups) Get(_ context.Context, actor, groupID uuid.UUID) (group.Details, error) {
	f.calls++
	f.gotActor, f.gotGroupID = actor, groupID
	if f.err != nil {
		return group.Details{}, f.err
	}
	d, ok := f.details[groupID]
	if !ok {
		return group.Details{}, fmt.Errorf("get group: %w", group.ErrNotFound)
	}
	return d, nil
}

func (f *fakeGroups) Create(_ context.Context, actor uuid.UUID, name string) (group.Details, error) {
	f.calls++
	f.gotActor, f.gotName = actor, name
	if f.err != nil {
		return group.Details{}, f.err
	}
	return f.created, nil
}

// newGroupRouter builds the real router, so the tests also check that the
// routes exist and requireUser sits in front of them.
func newGroupRouter(groups GroupService) http.Handler {
	return NewRouter(Deps{
		Env:      testEnv,
		DB:       fakePinger{},
		Sessions: &fakeSessions{fakeValidator: fakeValidator{validToken: groupsToken}},
		Users:    &fakeUsers{},
		Groups:   groups,
	})
}

// groupRequest builds a request, with the session cookie if loggedIn.
func groupRequest(method, path, body string, loggedIn bool) *http.Request {
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if loggedIn {
		req.AddCookie(&http.Cookie{Name: testCookieName, Value: groupsToken})
	}
	return req
}

func serve(router http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func groupPathFor(id uuid.UUID) string { return groupsPath + "/" + id.String() }

func memberPathFor(groupID, userID uuid.UUID) string {
	return groupPathFor(groupID) + "/members/" + userID.String()
}

func TestGroupRoutes_requireSession(t *testing.T) {
	routes := []struct{ method, path string }{
		{http.MethodGet, groupsPath},
		{http.MethodPost, groupsPath},
		{http.MethodGet, groupPathFor(testGroupID)},
		{http.MethodPatch, groupPathFor(testGroupID)},
		{http.MethodDelete, groupPathFor(testGroupID)},
		{http.MethodPatch, memberPathFor(testGroupID, otherUserID)},
		{http.MethodDelete, memberPathFor(testGroupID, otherUserID)},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			groups := &fakeGroups{}

			rec := serve(newGroupRouter(groups), groupRequest(route.method, route.path, `{"name":"x"}`, false))

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
			if groups.calls != 0 {
				t.Errorf("service was called %d times without a session", groups.calls)
			}
		})
	}
}

func TestGroupRoutes_wrongMethod(t *testing.T) {
	tests := []struct {
		name      string
		method    string
		path      string
		wantAllow string
	}{
		{"collection", http.MethodPut, groupsPath, "GET, POST"},
		{"single group", http.MethodPut, groupPathFor(testGroupID), "GET, PATCH, DELETE"},
		{"member", http.MethodPost, memberPathFor(testGroupID, otherUserID), "PATCH, DELETE"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serve(newGroupRouter(&fakeGroups{}), groupRequest(tt.method, tt.path, "", true))

			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
			}
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", got, tt.wantAllow)
			}
		})
	}
}

func TestListGroupsHandler(t *testing.T) {
	tests := []struct {
		name       string
		groups     *fakeGroups
		wantStatus int
		wantBody   string
	}{
		{
			name:       "groups with members",
			groups:     &fakeGroups{list: []group.Details{testGroupDetails()}},
			wantStatus: http.StatusOK,
			wantBody:   "[" + testGroupJSON + "]",
		},
		// A JSON array, never null: the frontend can loop over it as is.
		{
			name:       "no groups",
			groups:     &fakeGroups{},
			wantStatus: http.StatusOK,
			wantBody:   "[]",
		},
		{
			name:       "service failure",
			groups:     &fakeGroups{err: errors.New("connection refused")},
			wantStatus: http.StatusInternalServerError,
			wantBody:   `{"error":{"code":"INTERNAL_ERROR"}}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serve(newGroupRouter(tt.groups), groupRequest(http.MethodGet, groupsPath, "", true))

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
			if tt.groups.gotActor != testUserID {
				t.Errorf("actor = %s, want the user of the session %s", tt.groups.gotActor, testUserID)
			}
		})
	}
}

func TestGetGroupHandler(t *testing.T) {
	groups := func() *fakeGroups {
		return &fakeGroups{details: map[uuid.UUID]group.Details{testGroupID: testGroupDetails()}}
	}

	tests := []struct {
		name        string
		groups      *fakeGroups
		path        string
		wantStatus  int
		wantBody    string
		wantCalled  bool
		wantGroupID uuid.UUID
	}{
		{
			name:        "member",
			groups:      groups(),
			path:        groupPathFor(testGroupID),
			wantStatus:  http.StatusOK,
			wantBody:    testGroupJSON,
			wantCalled:  true,
			wantGroupID: testGroupID,
		},
		{
			name:        "not a member or unknown group",
			groups:      groups(),
			path:        groupPathFor(uuid.MustParse("0190a8c4-0000-7000-8000-0000000000ff")),
			wantStatus:  http.StatusNotFound,
			wantBody:    `{"error":{"code":"NOT_FOUND"}}`,
			wantCalled:  true,
			wantGroupID: uuid.MustParse("0190a8c4-0000-7000-8000-0000000000ff"),
		},
		// Such a group cannot exist, so the service is not even asked.
		{
			name:       "id is not a UUID",
			groups:     groups(),
			path:       groupsPath + "/not-a-uuid",
			wantStatus: http.StatusNotFound,
			wantBody:   `{"error":{"code":"NOT_FOUND"}}`,
		},
		{
			name:        "service failure",
			groups:      &fakeGroups{err: errors.New("connection refused")},
			path:        groupPathFor(testGroupID),
			wantStatus:  http.StatusInternalServerError,
			wantBody:    `{"error":{"code":"INTERNAL_ERROR"}}`,
			wantCalled:  true,
			wantGroupID: testGroupID,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serve(newGroupRouter(tt.groups), groupRequest(http.MethodGet, tt.path, "", true))

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
			if called := tt.groups.calls > 0; called != tt.wantCalled {
				t.Errorf("service called = %t, want %t", called, tt.wantCalled)
			}
			if tt.groups.gotGroupID != tt.wantGroupID {
				t.Errorf("group ID = %s, want %s", tt.groups.gotGroupID, tt.wantGroupID)
			}
			if tt.wantCalled && tt.groups.gotActor != testUserID {
				t.Errorf("actor = %s, want the user of the session %s", tt.groups.gotActor, testUserID)
			}
		})
	}
}

func TestCreateGroupHandler(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		groups     *fakeGroups
		wantStatus int
		wantBody   string
		wantCalled bool
		wantName   string
	}{
		{
			name:       "created",
			body:       `{"name":"WG Kaiserstraße"}`,
			groups:     &fakeGroups{created: testGroupDetails()},
			wantStatus: http.StatusCreated,
			wantBody:   testGroupJSON,
			wantCalled: true,
			wantName:   "WG Kaiserstraße",
		},
		{
			name:       "name rejected by the service",
			body:       `{"name":"   "}`,
			groups:     &fakeGroups{err: fmt.Errorf("%w: name is empty", group.ErrInvalidName)},
			wantStatus: http.StatusBadRequest,
			wantBody:   `{"error":{"code":"GROUP_NAME_INVALID"}}`,
			wantCalled: true,
			wantName:   "   ",
		},
		// A missing name arrives as "", which the service rejects, too.
		{
			name:       "name missing",
			body:       `{}`,
			groups:     &fakeGroups{err: group.ErrInvalidName},
			wantStatus: http.StatusBadRequest,
			wantBody:   `{"error":{"code":"GROUP_NAME_INVALID"}}`,
			wantCalled: true,
		},
		{
			name:       "not JSON",
			body:       `name=WG`,
			groups:     &fakeGroups{},
			wantStatus: http.StatusBadRequest,
			wantBody:   `{"error":{"code":"INVALID_REQUEST"}}`,
		},
		{
			name:       "body too large",
			body:       `{"name":"` + strings.Repeat("a", maxGroupBodyBytes) + `"}`,
			groups:     &fakeGroups{},
			wantStatus: http.StatusBadRequest,
			wantBody:   `{"error":{"code":"INVALID_REQUEST"}}`,
		},
		{
			name:       "service failure",
			body:       `{"name":"WG"}`,
			groups:     &fakeGroups{err: errors.New("connection refused")},
			wantStatus: http.StatusInternalServerError,
			wantBody:   `{"error":{"code":"INTERNAL_ERROR"}}`,
			wantCalled: true,
			wantName:   "WG",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serve(newGroupRouter(tt.groups), groupRequest(http.MethodPost, groupsPath, tt.body, true))

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
			if called := tt.groups.calls > 0; called != tt.wantCalled {
				t.Errorf("service called = %t, want %t", called, tt.wantCalled)
			}
			if tt.groups.gotName != tt.wantName {
				t.Errorf("name = %q, want %q", tt.groups.gotName, tt.wantName)
			}
			if tt.wantCalled && tt.groups.gotActor != testUserID {
				t.Errorf("actor = %s, want the user of the session %s", tt.groups.gotActor, testUserID)
			}
		})
	}
}

// groupCase is one request against the group routes, with what the response
// and the service call should look like.
type groupCase struct {
	name       string
	method     string
	path       string
	body       string
	groups     *fakeGroups
	wantStatus int
	wantBody   string
	// wantCalled is whether the service is reached at all; requests with a
	// broken body or ID must be turned away before.
	wantCalled bool
	// check inspects what the service was called with. Optional.
	check func(t *testing.T, f *fakeGroups)
}

func runGroupCases(t *testing.T, tests []groupCase) {
	t.Helper()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := serve(newGroupRouter(tt.groups), groupRequest(tt.method, tt.path, tt.body, true))

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != tt.wantBody {
				t.Errorf("body = %s, want %s", got, tt.wantBody)
			}
			if called := tt.groups.calls > 0; called != tt.wantCalled {
				t.Errorf("service called = %t, want %t", called, tt.wantCalled)
			}
			if tt.check != nil && tt.wantCalled {
				tt.check(t, tt.groups)
			}
		})
	}
}

const (
	errNotFoundBody  = `{"error":{"code":"NOT_FOUND"}}`
	errForbiddenBody = `{"error":{"code":"GROUP_OWNER_REQUIRED"}}`
	errLastOwnerBody = `{"error":{"code":"LAST_OWNER"}}`
	errInvalidBody   = `{"error":{"code":"INVALID_REQUEST"}}`
)

func TestRenameGroupHandler(t *testing.T) {
	path := groupPathFor(testGroupID)

	runGroupCases(t, []groupCase{
		{
			name: "renamed", method: http.MethodPatch, path: path, body: `{"name":" WG neu "}`,
			groups:     &fakeGroups{renamed: testGroupDetails()},
			wantStatus: http.StatusOK, wantBody: testGroupJSON, wantCalled: true,
			check: func(t *testing.T, f *fakeGroups) {
				// Trimming is the service's job; the handler passes the name on.
				if f.gotActor != testUserID || f.gotGroupID != testGroupID || f.gotName != " WG neu " {
					t.Errorf("called with actor %s, group %s, name %q", f.gotActor, f.gotGroupID, f.gotName)
				}
			},
		},
		{
			name: "member is not an owner", method: http.MethodPatch, path: path, body: `{"name":"x"}`,
			groups:     &fakeGroups{err: fmt.Errorf("rename: %w", group.ErrForbidden)},
			wantStatus: http.StatusForbidden, wantBody: errForbiddenBody, wantCalled: true,
		},
		{
			name: "not a member", method: http.MethodPatch, path: path, body: `{"name":"x"}`,
			groups:     &fakeGroups{err: group.ErrNotFound},
			wantStatus: http.StatusNotFound, wantBody: errNotFoundBody, wantCalled: true,
		},
		{
			name: "invalid name", method: http.MethodPatch, path: path, body: `{"name":""}`,
			groups:     &fakeGroups{err: group.ErrInvalidName},
			wantStatus: http.StatusBadRequest, wantBody: `{"error":{"code":"GROUP_NAME_INVALID"}}`, wantCalled: true,
		},
		{
			name: "not JSON", method: http.MethodPatch, path: path, body: `WG`,
			groups:     &fakeGroups{},
			wantStatus: http.StatusBadRequest, wantBody: errInvalidBody,
		},
		{
			name: "group ID is not a UUID", method: http.MethodPatch, path: groupsPath + "/nope", body: `{"name":"x"}`,
			groups:     &fakeGroups{},
			wantStatus: http.StatusNotFound, wantBody: errNotFoundBody,
		},
	})
}

func TestDeleteGroupHandler(t *testing.T) {
	path := groupPathFor(testGroupID)

	runGroupCases(t, []groupCase{
		{
			name: "deleted", method: http.MethodDelete, path: path,
			groups:     &fakeGroups{},
			wantStatus: http.StatusNoContent, wantBody: "", wantCalled: true,
			check: func(t *testing.T, f *fakeGroups) {
				if f.gotActor != testUserID || f.gotGroupID != testGroupID {
					t.Errorf("called with actor %s, group %s", f.gotActor, f.gotGroupID)
				}
			},
		},
		{
			name: "member is not an owner", method: http.MethodDelete, path: path,
			groups:     &fakeGroups{err: group.ErrForbidden},
			wantStatus: http.StatusForbidden, wantBody: errForbiddenBody, wantCalled: true,
		},
		{
			name: "not a member", method: http.MethodDelete, path: path,
			groups:     &fakeGroups{err: group.ErrNotFound},
			wantStatus: http.StatusNotFound, wantBody: errNotFoundBody, wantCalled: true,
		},
		{
			name: "group ID is not a UUID", method: http.MethodDelete, path: groupsPath + "/nope",
			groups:     &fakeGroups{},
			wantStatus: http.StatusNotFound, wantBody: errNotFoundBody,
		},
	})
}

func TestSetMemberRoleHandler(t *testing.T) {
	path := memberPathFor(testGroupID, otherUserID)
	wantCall := func(role group.Role) func(t *testing.T, f *fakeGroups) {
		return func(t *testing.T, f *fakeGroups) {
			if f.gotActor != testUserID || f.gotGroupID != testGroupID || f.gotUserID != otherUserID || f.gotRole != role {
				t.Errorf("called with actor %s, group %s, user %s, role %q",
					f.gotActor, f.gotGroupID, f.gotUserID, f.gotRole)
			}
		}
	}

	runGroupCases(t, []groupCase{
		{
			name: "make owner", method: http.MethodPatch, path: path, body: `{"role":"owner"}`,
			groups:     &fakeGroups{},
			wantStatus: http.StatusNoContent, wantBody: "", wantCalled: true, check: wantCall(group.RoleOwner),
		},
		{
			name: "make member", method: http.MethodPatch, path: path, body: `{"role":"member"}`,
			groups:     &fakeGroups{},
			wantStatus: http.StatusNoContent, wantBody: "", wantCalled: true, check: wantCall(group.RoleMember),
		},
		// The handler does not know the valid roles; the service says no.
		{
			name: "unknown role", method: http.MethodPatch, path: path, body: `{"role":"admin"}`,
			groups:     &fakeGroups{err: group.ErrInvalidRole},
			wantStatus: http.StatusBadRequest, wantBody: errInvalidBody, wantCalled: true, check: wantCall("admin"),
		},
		{
			name: "last owner steps down", method: http.MethodPatch, path: path, body: `{"role":"member"}`,
			groups:     &fakeGroups{err: group.ErrLastOwner},
			wantStatus: http.StatusConflict, wantBody: errLastOwnerBody, wantCalled: true,
		},
		{
			name: "member is not an owner", method: http.MethodPatch, path: path, body: `{"role":"owner"}`,
			groups:     &fakeGroups{err: group.ErrForbidden},
			wantStatus: http.StatusForbidden, wantBody: errForbiddenBody, wantCalled: true,
		},
		{
			name: "target is not in the group", method: http.MethodPatch, path: path, body: `{"role":"owner"}`,
			groups:     &fakeGroups{err: group.ErrNotFound},
			wantStatus: http.StatusNotFound, wantBody: errNotFoundBody, wantCalled: true,
		},
		{
			name: "not JSON", method: http.MethodPatch, path: path, body: `owner`,
			groups:     &fakeGroups{},
			wantStatus: http.StatusBadRequest, wantBody: errInvalidBody,
		},
		{
			name: "user ID is not a UUID", method: http.MethodPatch, path: groupPathFor(testGroupID) + "/members/nope",
			body: `{"role":"owner"}`, groups: &fakeGroups{},
			wantStatus: http.StatusNotFound, wantBody: errNotFoundBody,
		},
		{
			name: "group ID is not a UUID", method: http.MethodPatch, path: groupsPath + "/nope/members/" + otherUserID.String(),
			body: `{"role":"owner"}`, groups: &fakeGroups{},
			wantStatus: http.StatusNotFound, wantBody: errNotFoundBody,
		},
	})
}

func TestRemoveMemberHandler(t *testing.T) {
	wantCall := func(userID uuid.UUID) func(t *testing.T, f *fakeGroups) {
		return func(t *testing.T, f *fakeGroups) {
			if f.gotActor != testUserID || f.gotGroupID != testGroupID || f.gotUserID != userID {
				t.Errorf("called with actor %s, group %s, user %s", f.gotActor, f.gotGroupID, f.gotUserID)
			}
		}
	}
	other := memberPathFor(testGroupID, otherUserID)

	runGroupCases(t, []groupCase{
		{
			name: "remove someone else", method: http.MethodDelete, path: other,
			groups:     &fakeGroups{},
			wantStatus: http.StatusNoContent, wantBody: "", wantCalled: true, check: wantCall(otherUserID),
		},
		// Leaving is removing oneself: same route, own ID.
		{
			name: "leave", method: http.MethodDelete, path: memberPathFor(testGroupID, testUserID),
			groups:     &fakeGroups{},
			wantStatus: http.StatusNoContent, wantBody: "", wantCalled: true, check: wantCall(testUserID),
		},
		{
			name: "last owner", method: http.MethodDelete, path: memberPathFor(testGroupID, testUserID),
			groups:     &fakeGroups{err: group.ErrLastOwner},
			wantStatus: http.StatusConflict, wantBody: errLastOwnerBody, wantCalled: true,
		},
		{
			name: "member removes someone else", method: http.MethodDelete, path: other,
			groups:     &fakeGroups{err: group.ErrForbidden},
			wantStatus: http.StatusForbidden, wantBody: errForbiddenBody, wantCalled: true,
		},
		{
			name: "target is not in the group", method: http.MethodDelete, path: other,
			groups:     &fakeGroups{err: group.ErrNotFound},
			wantStatus: http.StatusNotFound, wantBody: errNotFoundBody, wantCalled: true,
		},
		{
			name: "user ID is not a UUID", method: http.MethodDelete, path: groupPathFor(testGroupID) + "/members/nope",
			groups:     &fakeGroups{},
			wantStatus: http.StatusNotFound, wantBody: errNotFoundBody,
		},
	})
}

// TestWriteGroupError checks the mapping of every domain error. Wrapped
// like the service does it, because the handlers must find the error inside
// the wrapping.
func TestWriteGroupError(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   apigen.ErrorCode
	}{
		{"not found", group.ErrNotFound, http.StatusNotFound, apigen.ErrorCodeNotFound},
		{"forbidden", group.ErrForbidden, http.StatusForbidden, apigen.ErrorCodeGroupOwnerRequired},
		{"invalid name", group.ErrInvalidName, http.StatusBadRequest, apigen.ErrorCodeGroupNameInvalid},
		{"invalid role", group.ErrInvalidRole, http.StatusBadRequest, apigen.ErrorCodeInvalidRequest},
		{"last owner", group.ErrLastOwner, http.StatusConflict, apigen.ErrorCodeLastOwner},
		{"anything else", errors.New("connection refused"), http.StatusInternalServerError, apigen.ErrorCodeInternal},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()

			writeGroupError(rec, "test", fmt.Errorf("do something: %w", tt.err))

			if rec.Code != tt.wantStatus {
				t.Errorf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			var body apigen.Error
			if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
				t.Fatalf("decode body: %v", err)
			}
			if body.Error.Code != tt.wantCode {
				t.Errorf("code = %q, want %q", body.Error.Code, tt.wantCode)
			}
		})
	}
}

// TestNewGroupResponse_enumsMatchContract catches a role added to the group
// domain but not to api/openapi.yaml: the conversion compiles either way.
func TestNewGroupResponse_enumsMatchContract(t *testing.T) {
	for _, role := range []group.Role{group.RoleOwner, group.RoleMember} {
		d := testGroupDetails()
		d.Role = role
		d.Members[0].Role = role

		resp := newGroupResponse(d)

		if !resp.Role.Valid() || !resp.Members[0].Role.Valid() {
			t.Errorf("role %q is not in the API contract", role)
		}
	}
}

// A group without members must not be written as null.
func TestNewGroupResponse_noMembers(t *testing.T) {
	d := testGroupDetails()
	d.Members = nil

	body, err := json.Marshal(newGroupResponse(d))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	if !strings.Contains(string(body), `"members":[]`) {
		t.Errorf("body = %s, want an empty members array", body)
	}
}
