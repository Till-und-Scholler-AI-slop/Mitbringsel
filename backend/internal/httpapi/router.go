// Package httpapi contains routing, handlers and the JSON error format.
package httpapi

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"mitbringsel/internal/config"
	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/realtime"
	"mitbringsel/internal/user"
)

// Requests per minute and key (see newLimiter). Generous for real people:
// a visitor opens an invite link a few times, not dozens.
const (
	loginRateLimit   = 10
	previewRateLimit = 30
	acceptRateLimit  = 10
	// A client that lost its connection retries with a growing pause, so
	// even a bad network stays far below this.
	wsUpgradeRateLimit = 30
)

// UserGetter loads a user by ID. *user.Service satisfies it; tests use a
// fake.
type UserGetter interface {
	Get(ctx context.Context, id uuid.UUID) (user.User, error)
}

// UserService is everything the handlers need from users. Embedding
// UserGetter adds its Get method to this interface, so handlers that only
// read users can keep asking for the smaller UserGetter.
type UserService interface {
	UserGetter
	SignIn(ctx context.Context, identity user.Identity) (user.User, error)
}

// Deps holds everything the handlers need. A struct with named fields stays
// readable as more domains are added, where a long parameter list would
// make it easy to swap two arguments of the same type.
type Deps struct {
	// Env selects the session cookie and whether the dev login exists.
	Env      config.Env
	DB       Pinger
	Sessions SessionManager
	Users    UserService
	Groups   GroupService
	Invites  InviteService
	Lists    ListService
	Items    ItemService
	// ItemClock stamps the item changes that arrive over REST.
	ItemClock ItemClock
	// Hub holds the live connections of /api/v1/ws.
	Hub *realtime.Hub
	// WSHandlers tracks active WebSocket handlers so server shutdown can wait
	// until they have written their close frames. Optional; nil skips tracking.
	WSHandlers *sync.WaitGroup
	// PublicBaseURL is where browsers reach the app. Live connections are
	// only accepted from pages of its host.
	PublicBaseURL string
	// Google is nil if the Google login is not configured, which only
	// development allows; its routes then answer 404.
	Google GoogleLogin
}

// router wraps http.ServeMux and remembers which methods each path pattern
// allows.
// The mux answers unknown paths and wrong methods with plain text; knowing
// the allowed methods lets us answer both in our JSON error format instead.
type router struct {
	mux     *http.ServeMux
	methods map[string][]string
}

// NewRouter builds the HTTP handler with all API routes registered.
func NewRouter(deps Deps) http.Handler {
	return newRouter(deps, defaultWSConfig)
}

// newRouter is NewRouter with the durations of the live connection
// as a parameter, so tests do not have to wait for the real ones.
func newRouter(deps Deps, ws wsConfig) http.Handler {
	r := &router{
		mux:     http.NewServeMux(),
		methods: make(map[string][]string),
	}

	// protect puts requireUser in front of a handler: only requests with a
	// valid session reach it.
	protect := requireUser(deps.Sessions, deps.Env)

	// One limiter per kind of route. The state lives in memory, which is
	// enough for one backend instance per environment. The routes below that
	// are open to everyone are limited by address; accepting an invite by
	// user, because it needs a login anyway. The Google login routes are
	// opened by navigation, so they send the browser to the login page
	// instead of answering 429 JSON.
	loginLimit := rateLimitWith(newLimiter(loginRateLimit, time.Minute, time.Now), ipKey(deps.Env), rejectLoginRateLimited)
	previewLimit := rateLimit(newLimiter(previewRateLimit, time.Minute, time.Now), ipKey(deps.Env))
	acceptLimit := rateLimit(newLimiter(acceptRateLimit, time.Minute, time.Now), userKey(deps.Env))
	// Besides the limit on open connections in the hub: this one stops a
	// client that reconnects in a loop.
	wsLimit := rateLimit(newLimiter(wsUpgradeRateLimit, time.Minute, time.Now), userKey(deps.Env))

	r.handle(http.MethodGet, HealthPath, healthHandler(deps.DB))
	r.handle(http.MethodGet, mePath, protect(meHandler(deps.Users)))
	r.handle(http.MethodGet, groupsPath, protect(listGroupsHandler(deps.Groups)))
	r.handle(http.MethodPost, groupsPath, protect(createGroupHandler(deps.Groups)))
	r.handle(http.MethodGet, groupPath, protect(getGroupHandler(deps.Groups)))
	r.handle(http.MethodPatch, groupPath, protect(updateGroupHandler(deps.Groups)))
	r.handle(http.MethodDelete, groupPath, protect(deleteGroupHandler(deps.Groups)))
	r.handle(http.MethodDelete, memberPath, protect(removeMemberHandler(deps.Groups)))
	r.handle(http.MethodPut, memberRolePath, protect(setMemberRoleHandler(deps.Groups)))
	r.handle(http.MethodGet, groupInvitesPath, protect(listInvitesHandler(deps.Invites)))
	r.handle(http.MethodPost, groupInvitesPath, protect(createInviteHandler(deps.Invites)))
	r.handle(http.MethodDelete, groupInvitePath, protect(revokeInviteHandler(deps.Invites)))
	r.handle(http.MethodGet, groupListsPath, protect(listListsHandler(deps.Lists)))
	r.handle(http.MethodPost, groupListsPath, protect(createListHandler(deps.Lists)))
	r.handle(http.MethodGet, listPath, protect(getListHandler(deps.Lists)))
	r.handle(http.MethodPatch, listPath, protect(updateListHandler(deps.Lists)))
	r.handle(http.MethodDelete, listPath, protect(deleteListHandler(deps.Lists)))
	r.handle(http.MethodPut, listArchivedPath, protect(setListArchivedHandler(deps.Lists)))
	r.handle(http.MethodGet, groupItemsPath, protect(groupItemsHandler(deps.Items)))
	r.handle(http.MethodGet, listItemsPath, protect(listItemsHandler(deps.Items)))
	r.handle(http.MethodPost, listItemsPath, protect(createItemHandler(deps.Items, deps.ItemClock)))
	r.handle(http.MethodPost, removeCheckedPath, protect(removeCheckedItemsHandler(deps.Items)))
	r.handle(http.MethodGet, itemPath, protect(getItemHandler(deps.Items)))
	r.handle(http.MethodPatch, itemPath, protect(updateItemHandler(deps.Items, deps.ItemClock)))
	r.handle(http.MethodDelete, itemPath, protect(deleteItemHandler(deps.Items)))
	r.handle(http.MethodPost, inviteAcceptPath, protect(acceptLimit(acceptInviteHandler(deps.Invites))))
	// The origin is checked before the session, so a page of another site
	// learns nothing about whether the visitor is logged in. The limit comes
	// after requireUser because it counts per user.
	r.handle(http.MethodGet, wsPath, requireOrigin(deps.PublicBaseURL)(protect(wsLimit(
		wsHandler(deps.Hub, deps.Groups, deps.PublicBaseURL, newWSHandlers(), ws, deps.WSHandlers)))))
	// Not behind requireUser: the page behind an invite link shows the
	// invitation before the visitor has signed in. The token is the secret.
	r.handle(http.MethodGet, invitePath, previewLimit(previewInviteHandler(deps.Invites)))
	// Not behind requireUser: logging out must work with an expired
	// session, too.
	r.handle(http.MethodPost, logoutPath, logoutHandler(deps.Sessions, deps.Env))

	if deps.Google != nil {
		r.handle(http.MethodGet, googleLoginPath, loginLimit(googleLoginHandler(deps.Google, deps.Env)))
		r.handle(http.MethodGet, GoogleCallbackPath, loginLimit(googleCallbackHandler(deps.Google, deps.Users, deps.Sessions, deps.Env)))
	}

	// Outside development the route does not exist at all and answers 404
	// like any unknown path, instead of being registered and then refused.
	if deps.Env == config.EnvDevelopment {
		r.handle(http.MethodPost, devLoginPath, devLoginHandler(deps.Users, deps.Sessions, deps.Env))
	}

	// "/" matches everything no other pattern matched.
	r.mux.HandleFunc("/", r.fallback)

	// CSRF protection around the whole router, so a new route cannot forget
	// it. It rejects state-changing methods (POST, PUT, DELETE, ...) sent
	// from another site; GET, HEAD and OPTIONS always pass.
	csrf := http.NewCrossOriginProtection()
	csrf.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusForbidden, apigen.ErrorCodeCrossOrigin)
	}))
	return csrf.Handler(r.mux)
}

func (r *router) handle(method, path string, h http.HandlerFunc) {
	r.mux.HandleFunc(method+" "+path, h)
	r.methods[path] = append(r.methods[path], method)
}

func (r *router) fallback(w http.ResponseWriter, req *http.Request) {
	for pattern, allowed := range r.methods {
		if matchesPattern(pattern, req.URL.Path) {
			w.Header().Set("Allow", strings.Join(allowed, ", "))
			writeError(w, http.StatusMethodNotAllowed, apigen.ErrorCodeMethodNotAllowed)
			return
		}
	}
	writeError(w, http.StatusNotFound, apigen.ErrorCodeNotFound)
}

// matchesPattern reports whether path fits a route pattern whose wildcards
// look like {groupId}. A wildcard matches exactly one non-empty segment, as
// in http.ServeMux; the mux itself cannot tell us this, because our "/"
// fallback matches every method.
func matchesPattern(pattern, path string) bool {
	patternParts := strings.Split(pattern, "/")
	pathParts := strings.Split(path, "/")
	if len(patternParts) != len(pathParts) {
		return false
	}
	for i, part := range patternParts {
		isWildcard := strings.HasPrefix(part, "{") && strings.HasSuffix(part, "}")
		if isWildcard && pathParts[i] != "" {
			continue
		}
		if part != pathParts[i] {
			return false
		}
	}
	return true
}
