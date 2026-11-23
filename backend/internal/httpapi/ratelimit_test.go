package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"tuolino/internal/config"
	"tuolino/internal/httpapi/apigen"
	"tuolino/internal/user"
)

// fakeClock is a clock that only moves when the test says so.
type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newTestClock() *fakeClock {
	return &fakeClock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
}

func TestLimiter(t *testing.T) {
	clock := newTestClock()
	l := newLimiter(3, time.Minute, clock.now)

	for i := range 3 {
		if ok, _ := l.allow("a"); !ok {
			t.Fatalf("request %d of the burst was refused", i+1)
		}
	}
	ok, retryAfter := l.allow("a")
	if ok {
		t.Fatal("request over the burst was allowed")
	}
	// 3 per minute is one token per 20 seconds.
	if retryAfter != 20*time.Second {
		t.Errorf("retryAfter = %v, want 20s", retryAfter)
	}

	if ok, _ := l.allow("b"); !ok {
		t.Error("another key was refused because of a")
	}

	clock.advance(19 * time.Second)
	if ok, _ := l.allow("a"); ok {
		t.Error("allowed 1s before the next token")
	}
	clock.advance(time.Second)
	if ok, _ := l.allow("a"); !ok {
		t.Error("refused after a token flowed back")
	}
	if ok, _ := l.allow("a"); ok {
		t.Error("only one token should have flowed back")
	}
}

func TestLimiter_refillIsCappedAtBurst(t *testing.T) {
	clock := newTestClock()
	l := newLimiter(2, time.Minute, clock.now)
	l.allow("a")
	l.allow("a")

	// A long pause must not store up more than the burst.
	clock.advance(time.Hour)
	for range 2 {
		if ok, _ := l.allow("a"); !ok {
			t.Fatal("refused within the burst after a pause")
		}
	}
	if ok, _ := l.allow("a"); ok {
		t.Error("allowed more than the burst after a long pause")
	}
}

func TestLimiter_sweepForgetsIdleKeys(t *testing.T) {
	clock := newTestClock()
	// Two tokens per two minutes: one token flows back per minute.
	l := newLimiter(2, 2*time.Minute, clock.now)
	l.allow("idle")
	l.allow("busy")
	l.allow("busy")

	// After a minute "idle" has all its tokens back; "busy" has one.
	clock.advance(sweepInterval)
	l.allow("new")

	if _, found := l.buckets["idle"]; found {
		t.Error("idle key was not swept")
	}
	if _, found := l.buckets["busy"]; !found {
		t.Error("key still below the burst was swept")
	}
}

func TestClientIP(t *testing.T) {
	tests := []struct {
		name      string
		env       config.Env
		remote    string
		forwarded []string
		want      string
	}{
		{name: "development ignores the header", env: config.EnvDevelopment, remote: "192.0.2.1:5000", forwarded: []string{"203.0.113.9"}, want: "192.0.2.1"},
		{name: "behind the proxy", env: config.EnvProduction, remote: "172.18.0.2:4000", forwarded: []string{"203.0.113.9"}, want: "203.0.113.9"},
		{name: "last entry wins over spoofed ones", env: config.EnvProduction, remote: "172.18.0.2:4000", forwarded: []string{"1.2.3.4, 203.0.113.9"}, want: "203.0.113.9"},
		{name: "several header lines", env: config.EnvStaging, remote: "172.18.0.2:4000", forwarded: []string{"1.2.3.4", "203.0.113.9"}, want: "203.0.113.9"},
		{name: "ipv6", env: config.EnvProduction, remote: "172.18.0.2:4000", forwarded: []string{"2001:db8::1"}, want: "2001:db8::1"},
		{name: "no header", env: config.EnvProduction, remote: "172.18.0.2:4000", want: "172.18.0.2"},
		{name: "garbage in the header", env: config.EnvProduction, remote: "172.18.0.2:4000", forwarded: []string{"not-an-ip"}, want: "172.18.0.2"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tt.remote
			for _, v := range tt.forwarded {
				req.Header.Add("X-Forwarded-For", v)
			}

			if got := clientIP(req, tt.env); got != tt.want {
				t.Errorf("clientIP = %q, want %q", got, tt.want)
			}
		})
	}
}

// requestFrom sends a request with the given client address through the
// router and returns the recorder.
func requestFrom(router http.Handler, method, path, ip string, mutate func(*http.Request)) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	req.RemoteAddr = ip + ":1234"
	if mutate != nil {
		mutate(req)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func requireRateLimited(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429, body %s", rec.Code, rec.Body)
	}
	var got apigen.Error
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil || got.Error.Code != apigen.ErrorCodeRateLimited {
		t.Errorf("body = %s, want code %s", rec.Body, apigen.ErrorCodeRateLimited)
	}
	seconds, err := strconv.Atoi(rec.Header().Get("Retry-After"))
	if err != nil || seconds < 1 {
		t.Errorf("Retry-After = %q, want a positive number of seconds", rec.Header().Get("Retry-After"))
	}
}

func TestPreviewInvite_rateLimitedPerAddress(t *testing.T) {
	invites := &fakeInvites{preview: testPreview()}
	router := NewRouter(Deps{Env: config.EnvDevelopment, DB: fakePinger{}, Sessions: &fakeSessions{}, Invites: invites})

	for i := range previewRateLimit {
		if rec := requestFrom(router, http.MethodGet, inviteTokenPath(""), "192.0.2.1", nil); rec.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d", i+1, rec.Code)
		}
	}
	requireRateLimited(t, requestFrom(router, http.MethodGet, inviteTokenPath(""), "192.0.2.1", nil))

	// The refused request never reached the service.
	if len(invites.calls) != previewRateLimit {
		t.Errorf("service calls = %d, want %d", len(invites.calls), previewRateLimit)
	}
	// Another address has its own budget.
	if rec := requestFrom(router, http.MethodGet, inviteTokenPath(""), "192.0.2.2", nil); rec.Code != http.StatusOK {
		t.Errorf("other address: status = %d, want 200", rec.Code)
	}
}

func TestPreviewInvite_forgedForwardedForDoesNotHelp(t *testing.T) {
	router := NewRouter(Deps{Env: config.EnvProduction, DB: fakePinger{}, Sessions: &fakeSessions{}, Invites: &fakeInvites{preview: testPreview()}})

	// The proxy appends the real address; the client invents the rest.
	send := func(i int) *httptest.ResponseRecorder {
		return requestFrom(router, http.MethodGet, inviteTokenPath(""), "172.18.0.2", func(r *http.Request) {
			r.Header.Set("X-Forwarded-For", "10.0.0."+strconv.Itoa(i)+", 203.0.113.9")
		})
	}
	for i := range previewRateLimit {
		send(i)
	}
	requireRateLimited(t, send(previewRateLimit))
}

func TestAcceptInvite_rateLimitedPerUser(t *testing.T) {
	invites := &fakeInvites{}
	router := NewRouter(Deps{
		Env:      config.EnvDevelopment,
		DB:       fakePinger{},
		Sessions: &fakeSessions{fakeValidator: fakeValidator{validToken: groupToken}},
		Users:    &fakeUsers{users: map[uuid.UUID]user.User{testUserID: testUser()}},
		Invites:  invites,
	})
	accept := func(ip string) *httptest.ResponseRecorder {
		return requestFrom(router, http.MethodPost, inviteTokenPath("/accept"), ip, func(r *http.Request) {
			r.AddCookie(&http.Cookie{Name: testCookieName, Value: groupToken})
		})
	}

	for i := range acceptRateLimit {
		if rec := accept("192.0.2.1"); rec.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d", i+1, rec.Code)
		}
	}
	// The same user from another address is still the same user.
	requireRateLimited(t, accept("192.0.2.2"))
}

func TestGoogleLogin_rateLimitedPerAddress(t *testing.T) {
	router := newGoogleRouter(config.EnvDevelopment, &fakeGoogle{}, &fakeSessions{}, &fakeUsers{})

	for i := range loginRateLimit {
		if rec := requestFrom(router, http.MethodGet, googleLoginPath, "192.0.2.1", nil); rec.Code != http.StatusFound {
			t.Fatalf("request %d: status = %d", i+1, rec.Code)
		}
	}
	requireLoginRateLimited(t, requestFrom(router, http.MethodGet, googleLoginPath, "192.0.2.1", nil), "/login?error=rate_limited")

	// Login and callback share one budget: the callback is refused, too.
	requireLoginRateLimited(t, requestFrom(router, http.MethodGet, GoogleCallbackPath, "192.0.2.1", nil), "/login?error=rate_limited")
}

func TestGoogleLogin_rateLimitKeepsNextPath(t *testing.T) {
	router := newGoogleRouter(config.EnvDevelopment, &fakeGoogle{}, &fakeSessions{}, &fakeUsers{})
	for range loginRateLimit {
		requestFrom(router, http.MethodGet, googleLoginPath, "192.0.2.1", nil)
	}

	requireLoginRateLimited(t,
		requestFrom(router, http.MethodGet, googleLoginPath+"?next=/invite/abc", "192.0.2.1", nil),
		"/login?error=rate_limited&next=%2Finvite%2Fabc")
	// A return path to another site is dropped here, too.
	requireLoginRateLimited(t,
		requestFrom(router, http.MethodGet, googleLoginPath+"?next=//evil.example", "192.0.2.1", nil),
		"/login?error=rate_limited")
}

// requireLoginRateLimited checks the answer of the Google login routes to
// too many requests: a redirect to the login page, with Retry-After.
func requireLoginRateLimited(t *testing.T, rec *httptest.ResponseRecorder, wantLocation string) {
	t.Helper()
	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusFound)
	}
	if got := rec.Header().Get("Location"); got != wantLocation {
		t.Errorf("Location = %q, want %q", got, wantLocation)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Error("no Retry-After header")
	}
}
