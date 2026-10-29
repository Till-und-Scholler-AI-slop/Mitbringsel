// Package httpapi contains routing, handlers and the JSON error format.
package httpapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"

	"mitbringsel/internal/config"
	"mitbringsel/internal/user"
)

// UserGetter loads a user by ID. *user.Service satisfies it; tests use a
// fake.
type UserGetter interface {
	Get(ctx context.Context, id uuid.UUID) (user.User, error)
}

// Deps holds everything the handlers need. A struct with named fields stays
// readable as more domains are added, where a long parameter list would
// make it easy to swap two arguments of the same type.
type Deps struct {
	// Env selects the session cookie name.
	Env      config.Env
	DB       Pinger
	Sessions SessionValidator
	Users    UserGetter
}

// router wraps http.ServeMux and remembers which methods each path allows.
// The mux answers unknown paths and wrong methods with plain text; knowing
// the allowed methods lets us answer both in our JSON error format instead.
type router struct {
	mux     *http.ServeMux
	methods map[string][]string
}

// NewRouter builds the HTTP handler with all API routes registered.
func NewRouter(deps Deps) http.Handler {
	r := &router{
		mux:     http.NewServeMux(),
		methods: make(map[string][]string),
	}

	// protect puts requireUser in front of a handler: only requests with a
	// valid session reach it.
	protect := requireUser(deps.Sessions, sessionCookieName(deps.Env))

	r.handle(http.MethodGet, HealthPath, healthHandler(deps.DB))
	r.handle(http.MethodGet, mePath, protect(meHandler(deps.Users)))

	// "/" matches everything no other pattern matched.
	r.mux.HandleFunc("/", r.fallback)
	return r.mux
}

func (r *router) handle(method, path string, h http.HandlerFunc) {
	r.mux.HandleFunc(method+" "+path, h)
	r.methods[path] = append(r.methods[path], method)
}

func (r *router) fallback(w http.ResponseWriter, req *http.Request) {
	if allowed, ok := r.methods[req.URL.Path]; ok {
		w.Header().Set("Allow", strings.Join(allowed, ", "))
		writeError(w, http.StatusMethodNotAllowed, CodeMethodNotAllowed)
		return
	}
	writeError(w, http.StatusNotFound, CodeNotFound)
}
