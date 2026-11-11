package httpapi

import (
	"net/http"
	"net/url"
	"strings"

	"mitbringsel/internal/httpapi/apigen"
)

// originAllowed reports whether origin may open a live connection: true if
// origin is empty (no browser page) or its host equals the host of
// publicBaseURL, ignoring case. The port is part of the host, the scheme is
// not compared.
//
// Browsers always send Origin on a WebSocket handshake, so a request
// without it comes from a script or tool, not from a web page. Such a
// request carries no ambient cookie of a victim, so there is nothing to
// protect. An origin we cannot parse, including the literal "null" of
// sandboxed pages, has no host and is refused.
func originAllowed(origin, publicBaseURL string) bool {
	if origin == "" {
		return true
	}
	o, err := url.Parse(origin)
	if err != nil || o.Host == "" {
		return false
	}
	base, err := url.Parse(publicBaseURL)
	if err != nil || base.Host == "" {
		return false
	}
	return strings.EqualFold(o.Host, base.Host)
}

// requireOrigin wraps handlers that open a live connection. It answers 403
// CROSS_ORIGIN_REQUEST if the request comes from a page of another site.
//
// http.CrossOriginProtection around the router does not cover this: it lets
// GET through, and a WebSocket handshake is a GET. Neither can the Host
// header stand in for the check, since the Vite proxy rewrites it in
// development.
func requireOrigin(publicBaseURL string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if !originAllowed(r.Header.Get("Origin"), publicBaseURL) {
				writeError(w, http.StatusForbidden, apigen.ErrorCodeCrossOrigin)
				return
			}
			next(w, r)
		}
	}
}
