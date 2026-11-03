package httpapi

import (
	"math"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"mitbringsel/internal/config"
	"mitbringsel/internal/httpapi/apigen"
)

// sweepInterval is how often the limiter drops the keys it has forgotten.
const sweepInterval = time.Minute

// bucket is the state of one key: how many requests it may still make, and
// when that was last worked out.
type bucket struct {
	tokens float64
	last   time.Time
}

// limiter is a token bucket per key. Every key starts with burst tokens, a
// request costs one, and tokens flow back at a steady rate. That allows a
// short burst, and a steady pace after it.
type limiter struct {
	// refillPerSecond and burst never change after newLimiter.
	refillPerSecond float64
	burst           float64
	// now is a field so tests can move the clock.
	now func() time.Time

	// mu guards the fields below: handlers run on many goroutines at once,
	// and a map must not be written by two of them at the same time.
	mu        sync.Mutex
	buckets   map[string]bucket
	lastSweep time.Time
}

// newLimiter allows burst requests per key at once, and burst requests per
// window on average.
func newLimiter(burst int, window time.Duration, now func() time.Time) *limiter {
	return &limiter{
		refillPerSecond: float64(burst) / window.Seconds(),
		burst:           float64(burst),
		now:             now,
		buckets:         make(map[string]bucket),
		lastSweep:       now(),
	}
}

// allow takes one token for the key. If none is left it returns false and
// how long until one is.
func (l *limiter) allow(key string) (ok bool, retryAfter time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.sweep(now)

	b, found := l.buckets[key]
	if !found {
		b = bucket{tokens: l.burst, last: now}
	}
	b.tokens = math.Min(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.refillPerSecond)
	b.last = now

	if b.tokens < 1 {
		l.buckets[key] = b
		missing := (1 - b.tokens) / l.refillPerSecond
		return false, time.Duration(missing * float64(time.Second))
	}
	b.tokens--
	l.buckets[key] = b
	return true, 0
}

// sweep drops keys whose bucket would be full again by now. A key that is
// not in the map starts full, so forgetting it changes nothing, and the map
// stays as small as the number of recently active keys. The caller holds mu.
func (l *limiter) sweep(now time.Time) {
	if now.Sub(l.lastSweep) < sweepInterval {
		return
	}
	l.lastSweep = now
	for key, b := range l.buckets {
		if b.tokens+now.Sub(b.last).Seconds()*l.refillPerSecond >= l.burst {
			delete(l.buckets, key)
		}
	}
}

// rateLimit puts a limiter in front of a handler. key says who a request
// belongs to; requests over the limit get 429 and are not passed on.
func rateLimit(l *limiter, key func(*http.Request) string) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			ok, retryAfter := l.allow(key(r))
			if !ok {
				// Retry-After counts whole seconds; rounding up keeps the
				// client from coming back a moment too early.
				w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(retryAfter.Seconds()))))
				writeError(w, http.StatusTooManyRequests, apigen.ErrorCodeRateLimited)
				return
			}
			next(w, r)
		}
	}
}

// ipKey keys requests by the address of the client.
func ipKey(env config.Env) func(*http.Request) string {
	return func(r *http.Request) string { return clientIP(r, env) }
}

// userKey keys requests by the signed-in user, and falls back to the
// address for a handler registered without requireUser.
func userKey(env config.Env) func(*http.Request) string {
	return func(r *http.Request) string {
		if id, ok := userIDFrom(r.Context()); ok {
			return id.String()
		}
		return clientIP(r, env)
	}
}

// clientIP returns the address of the client. Outside development the
// server runs behind Traefik, so RemoteAddr is always Traefik. Traefik
// appends the address it saw to X-Forwarded-For, which makes the last entry
// the only one we can trust: the entries before it were written by the
// client, who can put anything there.
func clientIP(r *http.Request, env config.Env) string {
	if env != config.EnvDevelopment {
		// The header can come in several lines; together they read as one
		// list, in order.
		forwarded := strings.Join(r.Header.Values("X-Forwarded-For"), ",")
		if forwarded != "" {
			last := forwarded[strings.LastIndex(forwarded, ",")+1:]
			if addr, err := netip.ParseAddr(strings.TrimSpace(last)); err == nil {
				return addr.String()
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
