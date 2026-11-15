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
	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/list"
	"mitbringsel/internal/user"
)

var (
	testListID = uuid.MustParse("0190a8c4-0000-7000-8000-0000000000b1")
	listTime   = time.Date(2026, time.March, 2, 9, 0, 0, 0, testZone)
)

// fakeLists returns the configured lists or error for every method and
// records the calls, so tests can check what the handler passed on.
type fakeLists struct {
	lists []list.List
	err   error

	// calls lists the methods that were called, with their arguments.
	calls []string
}

func (f *fakeLists) record(format string, args ...any) {
	f.calls = append(f.calls, fmt.Sprintf(format, args...))
}

func (f *fakeLists) first() (list.List, error) {
	if f.err != nil {
		return list.List{}, f.err
	}
	return f.lists[0], nil
}

func (f *fakeLists) Create(_ context.Context, actor, groupID uuid.UUID, name string, icon list.Icon) (list.List, error) {
	f.record("Create %s %s %q %q", actor, groupID, name, icon)
	return f.first()
}

func (f *fakeLists) ListForGroup(_ context.Context, actor, groupID uuid.UUID, includeArchived bool) ([]list.List, error) {
	f.record("ListForGroup %s %s %t", actor, groupID, includeArchived)
	return f.lists, f.err
}

func (f *fakeLists) Get(_ context.Context, actor, listID uuid.UUID) (list.List, error) {
	f.record("Get %s %s", actor, listID)
	return f.first()
}

func (f *fakeLists) Update(_ context.Context, actor, listID uuid.UUID, name string, icon list.Icon) (list.List, error) {
	f.record("Update %s %s %q %q", actor, listID, name, icon)
	return f.first()
}

func (f *fakeLists) Archive(_ context.Context, actor, listID uuid.UUID) (list.List, error) {
	f.record("Archive %s %s", actor, listID)
	return f.first()
}

func (f *fakeLists) Unarchive(_ context.Context, actor, listID uuid.UUID) (list.List, error) {
	f.record("Unarchive %s %s", actor, listID)
	return f.first()
}

func (f *fakeLists) Delete(_ context.Context, actor, listID uuid.UUID) error {
	f.record("Delete %s %s", actor, listID)
	return f.err
}

func testList() list.List {
	return list.List{
		ID:        testListID,
		GroupID:   testGroupID,
		Name:      "Supermarkt",
		Icon:      list.IconSupermarket,
		CreatedAt: listTime,
		UpdatedAt: listTime,
		ServerSeq: 42,
	}
}

// listRequest sends a request through the real router with a valid session
// cookie, so routing, requireUser and the handler run together.
func listRequest(t *testing.T, lists ListService, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	router := NewRouter(Deps{
		Env:      config.EnvDevelopment,
		DB:       fakePinger{},
		Sessions: &fakeSessions{fakeValidator: fakeValidator{validToken: groupToken}},
		Users:    &fakeUsers{users: map[uuid.UUID]user.User{testUserID: testUser()}},
		Lists:    lists,
	})
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.AddCookie(&http.Cookie{Name: testCookieName, Value: groupToken})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func groupListsPathFor() string {
	return groupPathFor("/lists")
}

func listPathFor(suffix string) string {
	return "/api/v1/lists/" + testListID.String() + suffix
}

func TestListResponses(t *testing.T) {
	archivedAt := listTime.Add(time.Hour)
	archived := testList()
	archived.ArchivedAt = &archivedAt

	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		list       list.List
		wantStatus int
		// wantCalls are the service calls in order.
		wantCalls []string
	}{
		{
			name: "get", method: http.MethodGet, path: listPathFor(""), list: testList(),
			wantStatus: http.StatusOK,
			wantCalls:  []string{fmt.Sprintf("Get %s %s", testUserID, testListID)},
		},
		// Without an icon the handler passes "" on; the service picks the
		// default or keeps the current one.
		{
			name: "create", method: http.MethodPost, path: groupListsPathFor(), body: `{"name":"Supermarkt"}`, list: testList(),
			wantStatus: http.StatusCreated,
			wantCalls:  []string{fmt.Sprintf("Create %s %s %q %q", testUserID, testGroupID, "Supermarkt", "")},
		},
		{
			name: "create with icon", method: http.MethodPost, path: groupListsPathFor(), body: `{"name":"Supermarkt","icon":"supermarket"}`, list: testList(),
			wantStatus: http.StatusCreated,
			wantCalls:  []string{fmt.Sprintf("Create %s %s %q %q", testUserID, testGroupID, "Supermarkt", "supermarket")},
		},
		{
			name: "rename", method: http.MethodPatch, path: listPathFor(""), body: `{"name":"Supermarkt"}`, list: testList(),
			wantStatus: http.StatusOK,
			wantCalls:  []string{fmt.Sprintf("Update %s %s %q %q", testUserID, testListID, "Supermarkt", "")},
		},
		// Unknown icons are the service's to reject, so the handler passes
		// them on unchanged.
		{
			name: "update with icon", method: http.MethodPatch, path: listPathFor(""), body: `{"name":"Supermarkt","icon":"spaceship"}`, list: testList(),
			wantStatus: http.StatusOK,
			wantCalls:  []string{fmt.Sprintf("Update %s %s %q %q", testUserID, testListID, "Supermarkt", "spaceship")},
		},
		{
			name: "archive", method: http.MethodPut, path: listPathFor("/archived"), body: `{"archived":true}`, list: archived,
			wantStatus: http.StatusOK,
			wantCalls:  []string{fmt.Sprintf("Archive %s %s", testUserID, testListID)},
		},
		{
			name: "unarchive", method: http.MethodPut, path: listPathFor("/archived"), body: `{"archived":false}`, list: testList(),
			wantStatus: http.StatusOK,
			wantCalls:  []string{fmt.Sprintf("Unarchive %s %s", testUserID, testListID)},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lists := &fakeLists{lists: []list.List{tt.list}}

			rec := listRequest(t, lists, tt.method, tt.path, tt.body)

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", rec.Code, tt.wantStatus, rec.Body)
			}
			if strings.Join(lists.calls, "|") != strings.Join(tt.wantCalls, "|") {
				t.Errorf("calls = %q, want %q", lists.calls, tt.wantCalls)
			}
			requireUTCTimestamps(t, rec.Body.Bytes())
			var got apigen.List
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatalf("decode body %s: %v", rec.Body, err)
			}
			if got.ID != testListID || got.GroupID != testGroupID || got.Name != "Supermarkt" || got.Icon != apigen.ListIconSupermarket || got.ServerSeq != 42 {
				t.Errorf("list = %+v", got)
			}
			if !got.CreatedAt.Equal(listTime) || !got.UpdatedAt.Equal(listTime) {
				t.Errorf("timestamps = %v, %v, want %v", got.CreatedAt, got.UpdatedAt, listTime)
			}
			wantArchived := tt.list.ArchivedAt != nil
			if gotArchived := got.ArchivedAt != nil; gotArchived != wantArchived {
				t.Errorf("archivedAt = %v, want archived = %t", got.ArchivedAt, wantArchived)
			}
		})
	}

	t.Run("an active list has archivedAt null", func(t *testing.T) {
		rec := listRequest(t, &fakeLists{lists: []list.List{testList()}}, http.MethodGet, listPathFor(""), "")

		if !strings.Contains(rec.Body.String(), `"archivedAt":null`) {
			t.Errorf("body = %s, want archivedAt:null", rec.Body)
		}
	})
}

func TestListLists(t *testing.T) {
	t.Run("no lists is an empty array, not null", func(t *testing.T) {
		rec := listRequest(t, &fakeLists{}, http.MethodGet, groupListsPathFor(), "")

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d", rec.Code)
		}
		if got := strings.TrimSpace(rec.Body.String()); got != `{"lists":[]}` {
			t.Errorf("body = %s", got)
		}
	})

	t.Run("lists of the group", func(t *testing.T) {
		lists := &fakeLists{lists: []list.List{testList()}}

		rec := listRequest(t, lists, http.MethodGet, groupListsPathFor(), "")

		requireUTCTimestamps(t, rec.Body.Bytes())
		var got apigen.ListList
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatalf("decode body %s: %v", rec.Body, err)
		}
		if len(got.Lists) != 1 || got.Lists[0].Name != "Supermarkt" {
			t.Errorf("lists = %+v", got.Lists)
		}
	})

	tests := []struct {
		query          string
		wantCall       string
		wantBadRequest bool
	}{
		{query: "", wantCall: fmt.Sprintf("ListForGroup %s %s false", testUserID, testGroupID)},
		{query: "?includeArchived=false", wantCall: fmt.Sprintf("ListForGroup %s %s false", testUserID, testGroupID)},
		{query: "?includeArchived=true", wantCall: fmt.Sprintf("ListForGroup %s %s true", testUserID, testGroupID)},
		{query: "?includeArchived=1", wantBadRequest: true},
		{query: "?includeArchived=yes", wantBadRequest: true},
	}
	for _, tt := range tests {
		t.Run("includeArchived"+tt.query, func(t *testing.T) {
			lists := &fakeLists{}

			rec := listRequest(t, lists, http.MethodGet, groupListsPathFor()+tt.query, "")

			if tt.wantBadRequest {
				if rec.Code != http.StatusBadRequest || strings.TrimSpace(rec.Body.String()) != errorBody("INVALID_REQUEST") {
					t.Errorf("status = %d, body = %s, want 400 INVALID_REQUEST", rec.Code, rec.Body)
				}
				if len(lists.calls) != 0 {
					t.Errorf("service was called: %q", lists.calls)
				}
				return
			}
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d", rec.Code)
			}
			if len(lists.calls) != 1 || lists.calls[0] != tt.wantCall {
				t.Errorf("calls = %q, want [%q]", lists.calls, tt.wantCall)
			}
		})
	}
}

func TestDeleteList(t *testing.T) {
	lists := &fakeLists{}

	rec := listRequest(t, lists, http.MethodDelete, listPathFor(""), "")

	if rec.Code != http.StatusNoContent || rec.Body.Len() != 0 {
		t.Errorf("status = %d, body = %q; want 204 and no body", rec.Code, rec.Body)
	}
	if want := fmt.Sprintf("Delete %s %s", testUserID, testListID); len(lists.calls) != 1 || lists.calls[0] != want {
		t.Errorf("calls = %q, want [%q]", lists.calls, want)
	}
}

// TestListErrors checks the mapping of domain errors on one route per
// operation; the mapping itself is shared by all handlers.
func TestListErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{"not found", fmt.Errorf("get list: %w", list.ErrNotFound), http.StatusNotFound, "LIST_NOT_FOUND"},
		{"forbidden", list.ErrForbidden, http.StatusForbidden, "FORBIDDEN"},
		{"invalid name", fmt.Errorf("%w: name is empty", list.ErrInvalidName), http.StatusBadRequest, "LIST_NAME_INVALID"},
		{"invalid icon", fmt.Errorf("%w: %q", list.ErrInvalidIcon, "x"), http.StatusBadRequest, "LIST_ICON_INVALID"},
		{"database failure", errors.New("connection refused"), http.StatusInternalServerError, "INTERNAL_ERROR"},
	}
	routes := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"list", http.MethodGet, groupListsPathFor(), ""},
		{"create", http.MethodPost, groupListsPathFor(), `{"name":"x"}`},
		{"get", http.MethodGet, listPathFor(""), ""},
		{"update", http.MethodPatch, listPathFor(""), `{"name":"x"}`},
		{"archive", http.MethodPut, listPathFor("/archived"), `{"archived":true}`},
		{"unarchive", http.MethodPut, listPathFor("/archived"), `{"archived":false}`},
		{"delete", http.MethodDelete, listPathFor(""), ""},
	}

	for _, route := range routes {
		for _, tt := range tests {
			t.Run(route.name+": "+tt.name, func(t *testing.T) {
				rec := listRequest(t, &fakeLists{err: tt.err}, route.method, route.path, route.body)

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

func TestListBadRequests(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"group ID is no UUID", http.MethodGet, groupsPath + "/nope/lists", ""},
		{"list ID is no UUID", http.MethodGet, "/api/v1/lists/nope", ""},
		{"list ID is no UUID when archiving", http.MethodPut, "/api/v1/lists/nope/archived", `{"archived":true}`},
		{"create without JSON", http.MethodPost, groupListsPathFor(), "name=x"},
		{"create without body", http.MethodPost, groupListsPathFor(), ""},
		{"update with broken JSON", http.MethodPatch, listPathFor(""), `{"name":`},
		// A missing field must not count as false and unarchive the list.
		{"archive without the field", http.MethodPut, listPathFor("/archived"), `{}`},
		{"archive with null", http.MethodPut, listPathFor("/archived"), `{"archived":null}`},
		{"archive with a string", http.MethodPut, listPathFor("/archived"), `{"archived":"true"}`},
		{"update with oversized body", http.MethodPatch, listPathFor(""),
			`{"name":"` + strings.Repeat("a", maxGroupBodyBytes) + `"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lists := &fakeLists{}

			rec := listRequest(t, lists, tt.method, tt.path, tt.body)

			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", rec.Code)
			}
			if got := strings.TrimSpace(rec.Body.String()); got != errorBody("INVALID_REQUEST") {
				t.Errorf("body = %s", got)
			}
			if len(lists.calls) != 0 {
				t.Errorf("service was called: %q", lists.calls)
			}
		})
	}
}

func TestListRoutesNeedLogin(t *testing.T) {
	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, groupListsPathFor()},
		{http.MethodPost, groupListsPathFor()},
		{http.MethodGet, listPathFor("")},
		{http.MethodPatch, listPathFor("")},
		{http.MethodDelete, listPathFor("")},
		{http.MethodPut, listPathFor("/archived")},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			lists := &fakeLists{}
			router := NewRouter(Deps{
				Env:      config.EnvDevelopment,
				DB:       fakePinger{},
				Sessions: &fakeSessions{fakeValidator: fakeValidator{validToken: groupToken}},
				Users:    &fakeUsers{},
				Lists:    lists,
			})
			// No session cookie.
			req := httptest.NewRequest(route.method, route.path, strings.NewReader(`{}`))
			rec := httptest.NewRecorder()

			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401", rec.Code)
			}
			if len(lists.calls) != 0 {
				t.Errorf("service was called: %q", lists.calls)
			}
		})
	}
}

func TestListWrongMethod(t *testing.T) {
	tests := []struct {
		path      string
		method    string
		wantAllow string
	}{
		{groupListsPathFor(), http.MethodDelete, "GET, POST"},
		{listPathFor(""), http.MethodPost, "GET, PATCH, DELETE"},
		{listPathFor("/archived"), http.MethodGet, "PUT"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			rec := listRequest(t, &fakeLists{}, tt.method, tt.path, "")

			if rec.Code != http.StatusMethodNotAllowed {
				t.Errorf("status = %d, want 405", rec.Code)
			}
			if got := rec.Header().Get("Allow"); got != tt.wantAllow {
				t.Errorf("Allow = %q, want %q", got, tt.wantAllow)
			}
		})
	}
}
