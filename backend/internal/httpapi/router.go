// Package httpapi contains routing, handlers and the JSON error format.
package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"mitbringsel/internal/config"
	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/user"
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
	// Google is nil if the Google login is not configured, which only
	// development allows; its routes then answer 404.
	Google GoogleLogin
}

// probeMethods are the methods the fallback tries to find out which ones a
// path allows. The order is the order of the Allow header.
var probeMethods = []string{
	http.MethodGet,
	http.MethodPost,
	http.MethodPut,
	http.MethodPatch,
	http.MethodDelete,
}

// router wraps http.ServeMux. The mux answers unknown paths and wrong
// methods with plain text; the fallback below answers both in our JSON error
// format instead.
type router struct {
	mux *http.ServeMux
}

// NewRouter builds the HTTP handler with all API routes registered.
func NewRouter(deps Deps) http.Handler {
	r := &router{mux: http.NewServeMux()}

	// protect puts requireUser in front of a handler: only requests with a
	// valid session reach it.
	protect := requireUser(deps.Sessions, deps.Env)

	r.handle(http.MethodGet, HealthPath, healthHandler(deps.DB))
	r.handle(http.MethodGet, mePath, protect(meHandler(deps.Users)))
	// Not behind requireUser: logging out must work with an expired
	// session, too.
	r.handle(http.MethodPost, logoutPath, logoutHandler(deps.Sessions, deps.Env))

	if deps.Google != nil {
		r.handle(http.MethodGet, googleLoginPath, googleLoginHandler(deps.Google, deps.Env))
		r.handle(http.MethodGet, GoogleCallbackPath, googleCallbackHandler(deps.Google, deps.Users, deps.Sessions, deps.Env))
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

// handle registers a handler for one method and path. The path may contain
// wildcards like "/groups/{groupId}".
func (r *router) handle(method, path string, h http.HandlerFunc) {
	r.mux.HandleFunc(method+" "+path, h)
}

func (r *router) fallback(w http.ResponseWriter, req *http.Request) {
	if allowed := r.allowedMethods(req); len(allowed) > 0 {
		w.Header().Set("Allow", strings.Join(allowed, ", "))
		writeError(w, http.StatusMethodNotAllowed, apigen.ErrorCodeMethodNotAllowed)
		return
	}
	writeError(w, http.StatusNotFound, apigen.ErrorCodeNotFound)
}

// allowedMethods returns the methods for which a route matches the request's
// path. It asks the mux itself, so wildcard paths like "/groups/<uuid>" work
// without a second matching logic that could disagree with the mux.
func (r *router) allowedMethods(req *http.Request) []string {
	var allowed []string
	for _, method := range probeMethods {
		probe := req.Clone(req.Context())
		probe.Method = method
		// Without a more specific route the mux answers with the "/"
		// catch-all, which is this fallback.
		if _, pattern := r.mux.Handler(probe); pattern != "/" {
			allowed = append(allowed, method)
		}
	}
	return allowed
}
