// Package httpapi contains routing, handlers and the JSON error format.
package httpapi

import (
	"net/http"
	"strings"
)

// router wraps http.ServeMux and remembers which methods each path allows.
// The mux answers unknown paths and wrong methods with plain text; knowing
// the allowed methods lets us answer both in our JSON error format instead.
type router struct {
	mux     *http.ServeMux
	methods map[string][]string
}

// NewRouter builds the HTTP handler with all API routes registered.
func NewRouter(db Pinger) http.Handler {
	r := &router{
		mux:     http.NewServeMux(),
		methods: make(map[string][]string),
	}

	r.handle(http.MethodGet, HealthPath, healthHandler(db))

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
