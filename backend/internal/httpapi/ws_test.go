package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"mitbringsel/internal/auth"
	"mitbringsel/internal/config"
	"mitbringsel/internal/group"
	"mitbringsel/internal/item"
	"mitbringsel/internal/realtime"
)

// These tests open real connections to an httptest server: a WebSocket needs
// a hijackable TCP connection, which httptest.ResponseRecorder cannot offer.
// The durations that matter are shortened through wsConfig; every wait is
// five seconds, far more than the code needs, so a slow machine does not
// make a test fail.

const (
	wsTestBaseURL = "http://localhost:5173"
	wsTestToken   = "WS-TOKEN"
	wsOtherToken  = "WS-OTHER-TOKEN"
	wsWait        = 5 * time.Second
)

var (
	wsOtherUserID = uuid.MustParse("0190a8c4-0000-7000-8000-000000000003")
	wsOtherGroup  = uuid.MustParse("0190a8c4-0000-7000-8000-0000000000a2")
)

// fakeWSSessions maps tokens to users. Unlike fakeValidator it records
// nothing: the handlers run on other goroutines than the test, and a
// recording slice would be a data race.
type fakeWSSessions struct {
	users        map[string]uuid.UUID
	renewedUntil time.Time
}

func (f *fakeWSSessions) Validate(_ context.Context, token string) (uuid.UUID, time.Time, error) {
	userID, ok := f.users[token]
	if !ok {
		return uuid.Nil, time.Time{}, auth.ErrSessionNotFound
	}
	return userID, f.renewedUntil, nil
}

func (f *fakeWSSessions) Create(context.Context, uuid.UUID) (string, time.Time, error) {
	return "", time.Time{}, errors.New("fakeWSSessions: Create is not used")
}

func (f *fakeWSSessions) Delete(context.Context, string) error {
	return errors.New("fakeWSSessions: Delete is not used")
}

// wsTestOptions are the settings of a test server; the zero value is a
// server with the default durations and the default connection limit.
type wsTestOptions struct {
	groups   *fakeGroups
	sessions *fakeWSSessions
	cfg      wsConfig
	maxConns int
	// items builds the item service of the server from the Broadcaster that
	// is wired to its hub. Nil: the server has no item routes.
	items func(pub item.Publisher) ItemService
}

// wsTestServer is the router behind a real listener.
type wsTestServer struct {
	// url is the address of the server, http://127.0.0.1:<port>.
	url string
	hub *realtime.Hub
	// handlerDone receives one value every time a request has been fully
	// served, which for a WebSocket means: the connection is over and the
	// handler has cleaned up.
	handlerDone chan struct{}
}

func newWSTestServer(t *testing.T, opts wsTestOptions) *wsTestServer {
	t.Helper()
	if opts.groups == nil {
		opts.groups = &fakeGroups{}
	}
	if opts.sessions == nil {
		opts.sessions = &fakeWSSessions{users: map[string]uuid.UUID{
			wsTestToken:  testUserID,
			wsOtherToken: wsOtherUserID,
		}}
	}
	if opts.cfg == (wsConfig{}) {
		opts.cfg = defaultWSConfig
	}
	if opts.maxConns == 0 {
		opts.maxConns = realtime.DefaultMaxConnsPerUser
	}

	hub := realtime.NewHub(opts.maxConns, realtime.DefaultSendBuffer)
	var items ItemService
	if opts.items != nil {
		items = opts.items(NewBroadcaster(hub))
	}
	router := newRouter(Deps{
		Env:           config.EnvDevelopment,
		DB:            fakePinger{},
		Sessions:      opts.sessions,
		Groups:        opts.groups,
		Items:         items,
		ItemClock:     fakeItemClock{},
		Hub:           hub,
		PublicBaseURL: wsTestBaseURL,
	}, opts.cfg)

	// A buffer and a send that never blocks, so a test that ignores
	// handlerDone cannot hang the server.
	handlerDone := make(chan struct{}, 64)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			select {
			case handlerDone <- struct{}{}:
			default:
			}
		}()
		router.ServeHTTP(w, r)
	}))
	// Closing the hub first ends the connections that are still open.
	// srv.Close does not wait for them: it forgets hijacked connections.
	t.Cleanup(func() {
		hub.Close()
		srv.Close()
	})
	return &wsTestServer{url: srv.URL, hub: hub, handlerDone: handlerDone}
}

// waitHandlerDone waits until one request has been served completely.
func (s *wsTestServer) waitHandlerDone(t *testing.T) {
	t.Helper()
	select {
	case <-s.handlerDone:
	case <-time.After(wsWait):
		t.Fatal("handler did not return in time")
	}
}

// wsHeader is what a logged-in browser sends with the handshake.
func wsHeader(token, origin string) http.Header {
	h := http.Header{}
	if token != "" {
		h.Set("Cookie", (&http.Cookie{Name: testCookieName, Value: token}).String())
	}
	if origin != "" {
		h.Set("Origin", origin)
	}
	return h
}

// dialWS opens a connection with the given headers and returns the
// handshake response too. The client end is closed with the test.
func dialWS(t *testing.T, srv *wsTestServer, header http.Header) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), wsWait)
	defer cancel()

	conn, resp, err := websocket.Dial(ctx, srv.url+wsPath, &websocket.DialOptions{HTTPHeader: header})
	if err == nil {
		t.Cleanup(func() { _ = conn.CloseNow() })
	}
	return conn, resp, err
}

// connectWS opens a connection as the user with the token and fails the
// test if that does not work.
func connectWS(t *testing.T, srv *wsTestServer, token string) *websocket.Conn {
	t.Helper()
	conn, _, err := dialWS(t, srv, wsHeader(token, wsTestBaseURL))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return conn
}

// wsMessage is a server message as the test reads it.
type wsMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

func readMessage(t *testing.T, conn *websocket.Conn) wsMessage {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), wsWait)
	defer cancel()

	typ, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if typ != websocket.MessageText {
		t.Fatalf("message type = %v, want text", typ)
	}
	var msg wsMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("message %q is not JSON: %v", data, err)
	}
	return msg
}

// requireMessage reads the next message and checks its type.
func requireMessage(t *testing.T, conn *websocket.Conn, wantType string) wsMessage {
	t.Helper()
	msg := readMessage(t, conn)
	if msg.Type != wantType {
		t.Fatalf("message type = %q, want %q (payload %s)", msg.Type, wantType, msg.Payload)
	}
	return msg
}

func writeText(t *testing.T, conn *websocket.Conn, text string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), wsWait)
	defer cancel()
	if err := conn.Write(ctx, websocket.MessageText, []byte(text)); err != nil {
		t.Fatalf("write %q: %v", text, err)
	}
}

// requirePong sends a ping and expects the pong as the very next message.
// After a Broadcast it shows what did and did not arrive before it: the hub
// queues in order.
func requirePong(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	writeText(t, conn, `{"type":"ping"}`)
	requireMessage(t, conn, "pong")
}

// requireCloseStatus reads until the server closes the connection and checks
// the close code and reason it sent. An empty wantReason skips the reason,
// for closes whose text comes from the library.
func requireCloseStatus(t *testing.T, conn *websocket.Conn, want websocket.StatusCode, wantReason string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), wsWait)
	defer cancel()

	_, data, err := conn.Read(ctx)
	if err == nil {
		t.Fatalf("read = %q, want the connection to be closed with %d", data, want)
	}
	var closeErr websocket.CloseError
	if !errors.As(err, &closeErr) {
		t.Fatalf("read error = %v, want a close frame with %d", err, want)
	}
	if closeErr.Code != want || (wantReason != "" && closeErr.Reason != wantReason) {
		t.Errorf("close = %d %q, want %d %q", closeErr.Code, closeErr.Reason, want, wantReason)
	}
}

// wsGroups is a fake that knows one group.
func wsGroups() *fakeGroups {
	return &fakeGroups{details: []group.Details{{Group: group.Group{ID: testGroupID}}}}
}

func TestWS_rejectsBeforeUpgrade(t *testing.T) {
	tests := []struct {
		name     string
		token    string
		origin   string
		maxConns int
		// prepare runs before the request under test.
		prepare    func(t *testing.T, srv *wsTestServer)
		wantStatus int
		wantCode   string
	}{
		{
			name: "no cookie", origin: wsTestBaseURL,
			wantStatus: http.StatusUnauthorized, wantCode: "UNAUTHENTICATED",
		},
		{
			name: "invalid cookie", token: "WRONG-TOKEN", origin: wsTestBaseURL,
			wantStatus: http.StatusUnauthorized, wantCode: "UNAUTHENTICATED",
		},
		{
			name: "origin of another site", token: wsTestToken, origin: "https://evil.example.org",
			wantStatus: http.StatusForbidden, wantCode: "CROSS_ORIGIN_REQUEST",
		},
		{
			name: "origin of another site, no cookie", origin: "https://evil.example.org",
			wantStatus: http.StatusForbidden, wantCode: "CROSS_ORIGIN_REQUEST",
		},
		{
			name: "user at the connection limit", token: wsTestToken, origin: wsTestBaseURL, maxConns: 2,
			prepare: func(t *testing.T, srv *wsTestServer) {
				for range 2 {
					requireMessage(t, connectWS(t, srv, wsTestToken), "ready")
				}
			},
			wantStatus: http.StatusTooManyRequests, wantCode: "RATE_LIMITED",
		},
		{
			name: "hub already closed", token: wsTestToken, origin: wsTestBaseURL,
			prepare:    func(_ *testing.T, srv *wsTestServer) { srv.hub.Close() },
			wantStatus: http.StatusServiceUnavailable, wantCode: "INTERNAL_ERROR",
		},
		{
			name: "too many upgrades per minute", token: wsTestToken, origin: wsTestBaseURL,
			prepare: func(t *testing.T, srv *wsTestServer) {
				// Plain requests without the upgrade headers: the library
				// refuses them with 426, but each has used up one token.
				for range wsUpgradeRateLimit {
					resp := getWS(t, srv, wsTestToken, wsTestBaseURL)
					if resp.StatusCode != http.StatusUpgradeRequired {
						t.Fatalf("status = %d, want 426", resp.StatusCode)
					}
				}
			},
			wantStatus: http.StatusTooManyRequests, wantCode: "RATE_LIMITED",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := newWSTestServer(t, wsTestOptions{groups: wsGroups(), maxConns: tt.maxConns})
			if tt.prepare != nil {
				tt.prepare(t, srv)
			}

			resp := getWS(t, srv, tt.token, tt.origin)

			if resp.StatusCode != tt.wantStatus {
				t.Errorf("status = %d, want %d", resp.StatusCode, tt.wantStatus)
			}
			body, err := io.ReadAll(resp.Body)
			if err != nil {
				t.Fatalf("read body: %v", err)
			}
			if got := strings.TrimSpace(string(body)); got != errorBody(tt.wantCode) {
				t.Errorf("body = %q, want %q", got, errorBody(tt.wantCode))
			}
		})
	}
}

// getWS sends a plain GET to the WebSocket route, as a browser would
// before it gets as far as the upgrade headers.
func getWS(t *testing.T, srv *wsTestServer, token, origin string) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.url+wsPath, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header = wsHeader(token, origin)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET %s: %v", wsPath, err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func TestWS_withoutOriginHeader(t *testing.T) {
	srv := newWSTestServer(t, wsTestOptions{groups: wsGroups()})

	conn, _, err := dialWS(t, srv, wsHeader(wsTestToken, ""))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	requireMessage(t, conn, "ready")
}

func TestWS_renewsSessionCookieOnUpgrade(t *testing.T) {
	renewedUntil := time.Now().Add(30 * 24 * time.Hour).Truncate(time.Second)
	srv := newWSTestServer(t, wsTestOptions{sessions: &fakeWSSessions{
		users:        map[string]uuid.UUID{wsTestToken: testUserID},
		renewedUntil: renewedUntil,
	}})

	conn, resp, err := dialWS(t, srv, wsHeader(wsTestToken, wsTestBaseURL))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	requireMessage(t, conn, "ready")

	var got *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == testCookieName {
			got = c
		}
	}
	if got == nil {
		t.Fatal("the 101 response did not renew the session cookie")
	}
	if got.Value != wsTestToken || !got.Expires.Equal(renewedUntil) {
		t.Errorf("cookie = %q until %v, want %q until %v", got.Value, got.Expires, wsTestToken, renewedUntil)
	}
}

func TestWS_sendsReadyAndJoinsGroups(t *testing.T) {
	srv := newWSTestServer(t, wsTestOptions{groups: wsGroups()})
	conn := connectWS(t, srv, wsTestToken)

	requireMessage(t, conn, "ready")

	srv.hub.Broadcast(wsOtherGroup, []byte(`{"type":"leak"}`))
	srv.hub.Broadcast(testGroupID, []byte(`{"type":"groupChanged"}`))
	requireMessage(t, conn, "groupChanged")
	// The message for the other group would have been queued before this
	// pong, so a pong as the next message proves it did not arrive.
	requirePong(t, conn)
}

func TestWS_twoUsersShareAGroup(t *testing.T) {
	srv := newWSTestServer(t, wsTestOptions{groups: wsGroups()})
	anna := connectWS(t, srv, wsTestToken)
	ben := connectWS(t, srv, wsOtherToken)
	requireMessage(t, anna, "ready")
	requireMessage(t, ben, "ready")

	srv.hub.Broadcast(testGroupID, []byte(`{"type":"groupChanged"}`))

	requireMessage(t, anna, "groupChanged")
	requireMessage(t, ben, "groupChanged")
}

// publishingItems is a fake item service that publishes like the real one:
// it answers with the canned item of the embedded fakeItems, then tells the
// publisher. The real service logic is covered in the item package.
type publishingItems struct {
	*fakeItems
	pub item.Publisher
}

func (p publishingItems) Update(ctx context.Context, actor, itemID uuid.UUID, c item.Change, clock item.HLC) (item.Item, error) {
	it, err := p.fakeItems.Update(ctx, actor, itemID, c, clock)
	if err == nil {
		p.pub.ItemChanged(ctx, testGroupID, actor, it)
	}
	return it, err
}

func (p publishingItems) Delete(ctx context.Context, actor, itemID uuid.UUID) (item.Item, error) {
	it, err := p.fakeItems.Delete(ctx, actor, itemID)
	if err == nil {
		p.pub.ItemDeleted(ctx, testGroupID, actor, it)
	}
	return it, err
}

// sendREST sends a request to the server as the user with the token. It
// sends no Origin header: with one, CrossOriginProtection would refuse the
// PATCH and DELETE, because the test server listens on 127.0.0.1 and not on
// the host of the Origin. Without Origin and Sec-Fetch-Site the request
// counts as not coming from a browser and passes.
func sendREST(t *testing.T, srv *wsTestServer, token, method, path, body string) *http.Response {
	t.Helper()
	req, err := http.NewRequestWithContext(t.Context(), method, srv.url+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header = wsHeader(token, "")
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	t.Cleanup(func() { _ = resp.Body.Close() })
	return resp
}

func TestWS_itemEventsReachTheGroup(t *testing.T) {
	// The fake is only touched by the handler goroutines; the test does not
	// read fakeItems.calls, which would be a data race.
	srv := newWSTestServer(t, wsTestOptions{
		groups: wsGroups(),
		items: func(pub item.Publisher) ItemService {
			return publishingItems{fakeItems: &fakeItems{items: []item.Item{testItem()}}, pub: pub}
		},
	})
	anna := connectWS(t, srv, wsTestToken)
	ben := connectWS(t, srv, wsOtherToken)
	requireMessage(t, anna, "ready")
	requireMessage(t, ben, "ready")

	resp := sendREST(t, srv, wsTestToken, http.MethodPatch, itemPathFor(), `{"name":"Mehl"}`)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH status = %d, want 200", resp.StatusCode)
	}

	// The actor's own connection gets the event, too: its tab discards it
	// because the serverSeq is the one of the REST answer.
	for name, conn := range map[string]*websocket.Conn{"anna": anna, "ben": ben} {
		msg := requireMessage(t, conn, "itemChanged")
		var payload struct {
			ActorID uuid.UUID `json:"actorId"`
			GroupID uuid.UUID `json:"groupId"`
			Item    struct {
				ID uuid.UUID `json:"id"`
			} `json:"item"`
		}
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			t.Fatalf("%s: payload %s: %v", name, msg.Payload, err)
		}
		if payload.ActorID != testUserID || payload.GroupID != testGroupID || payload.Item.ID != testItemID {
			t.Errorf("%s: payload = %s, want actor %s, group %s, item %s", name, msg.Payload, testUserID, testGroupID, testItemID)
		}
	}

	resp = sendREST(t, srv, wsTestToken, http.MethodDelete, itemPathFor(), "")
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("DELETE status = %d, want 204", resp.StatusCode)
	}

	for name, conn := range map[string]*websocket.Conn{"anna": anna, "ben": ben} {
		msg := requireMessage(t, conn, "itemDeleted")
		var payload struct {
			ActorID uuid.UUID `json:"actorId"`
			ItemID  uuid.UUID `json:"itemId"`
			ListID  uuid.UUID `json:"listId"`
		}
		if err := json.Unmarshal(msg.Payload, &payload); err != nil {
			t.Fatalf("%s: payload %s: %v", name, msg.Payload, err)
		}
		if payload.ActorID != testUserID || payload.ItemID != testItemID || payload.ListID != testListID {
			t.Errorf("%s: payload = %s, want actor %s, item %s, list %s", name, msg.Payload, testUserID, testItemID, testListID)
		}
	}
}

func TestWS_pingPong(t *testing.T) {
	srv := newWSTestServer(t, wsTestOptions{})
	conn := connectWS(t, srv, wsTestToken)
	requireMessage(t, conn, "ready")

	requirePong(t, conn)
	requirePong(t, conn)
}

func TestWS_unknownTypeKeepsConnection(t *testing.T) {
	srv := newWSTestServer(t, wsTestOptions{})
	conn := connectWS(t, srv, wsTestToken)
	requireMessage(t, conn, "ready")

	writeText(t, conn, `{"type":"bogus"}`)

	msg := requireMessage(t, conn, "error")
	if got, want := string(msg.Payload), `{"code":"INVALID_REQUEST"}`; got != want {
		t.Errorf("payload = %s, want %s", got, want)
	}
	requirePong(t, conn)
}

func TestWS_closesOnBadInput(t *testing.T) {
	tests := []struct {
		name       string
		typ        websocket.MessageType
		data       string
		wantCode   websocket.StatusCode
		wantReason string
	}{
		{
			name: "not JSON", typ: websocket.MessageText, data: "hello",
			wantCode: websocket.StatusPolicyViolation, wantReason: "invalid message",
		},
		{
			name: "no type", typ: websocket.MessageText, data: `{}`,
			wantCode: websocket.StatusPolicyViolation, wantReason: "invalid message",
		},
		{
			name: "type is not a string", typ: websocket.MessageText, data: `{"type":5}`,
			wantCode: websocket.StatusPolicyViolation, wantReason: "invalid message",
		},
		{
			name: "binary message", typ: websocket.MessageBinary, data: `{"type":"ping"}`,
			wantCode: websocket.StatusUnsupportedData, wantReason: "text messages only",
		},
		{
			name: "message over the limit", typ: websocket.MessageText,
			data:     `{"type":"ping","padding":"` + strings.Repeat("x", 5<<10) + `"}`,
			wantCode: websocket.StatusMessageTooBig,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := newWSTestServer(t, wsTestOptions{})
			conn := connectWS(t, srv, wsTestToken)
			requireMessage(t, conn, "ready")

			ctx, cancel := context.WithTimeout(t.Context(), wsWait)
			defer cancel()
			if err := conn.Write(ctx, tt.typ, []byte(tt.data)); err != nil {
				t.Fatalf("write: %v", err)
			}

			requireCloseStatus(t, conn, tt.wantCode, tt.wantReason)
			srv.waitHandlerDone(t)
		})
	}
}

func TestWS_closesSilentConnection(t *testing.T) {
	cfg := defaultWSConfig
	cfg.readTimeout = 100 * time.Millisecond
	srv := newWSTestServer(t, wsTestOptions{cfg: cfg})
	conn := connectWS(t, srv, wsTestToken)
	requireMessage(t, conn, "ready")

	ctx, cancel := context.WithTimeout(t.Context(), wsWait)
	defer cancel()
	_, _, err := conn.Read(ctx)

	if err == nil {
		t.Fatal("read succeeded, want the server to end the silent connection")
	}
	// The library drops an expired read without a close frame: the browser
	// sees 1006.
	if got := websocket.CloseStatus(err); got != -1 {
		t.Errorf("close status = %d, want none (no close frame)", got)
	}
	srv.waitHandlerDone(t)
}

func TestWS_closesAfterLifetime(t *testing.T) {
	cfg := defaultWSConfig
	cfg.maxLifetime = 150 * time.Millisecond
	srv := newWSTestServer(t, wsTestOptions{cfg: cfg})
	conn := connectWS(t, srv, wsTestToken)
	requireMessage(t, conn, "ready")

	requireCloseStatus(t, conn, websocket.StatusGoingAway, "connection lifetime reached")
	srv.waitHandlerDone(t)
}

func TestWS_hubCloseGoesAway(t *testing.T) {
	srv := newWSTestServer(t, wsTestOptions{})
	conn := connectWS(t, srv, wsTestToken)
	requireMessage(t, conn, "ready")

	srv.hub.Close()

	requireCloseStatus(t, conn, websocket.StatusGoingAway, "server shutting down")
	srv.waitHandlerDone(t)
}

func TestWS_groupLoadFails(t *testing.T) {
	srv := newWSTestServer(t, wsTestOptions{groups: &fakeGroups{err: errors.New("database down")}})
	conn := connectWS(t, srv, wsTestToken)

	// No ready: the first thing the client sees is the close.
	requireCloseStatus(t, conn, websocket.StatusInternalError, "internal error")
	srv.waitHandlerDone(t)
}

func TestWS_releasesConnectionOnDisconnect(t *testing.T) {
	const limit = 2
	srv := newWSTestServer(t, wsTestOptions{maxConns: limit})
	var conns []*websocket.Conn
	for range limit {
		conn := connectWS(t, srv, wsTestToken)
		requireMessage(t, conn, "ready")
		conns = append(conns, conn)
	}

	for _, conn := range conns {
		if err := conn.CloseNow(); err != nil {
			t.Fatalf("close client: %v", err)
		}
	}
	for range limit {
		srv.waitHandlerDone(t)
	}

	// The handlers have returned, so both places are free again, and the
	// limit itself is unchanged.
	for range limit {
		if _, err := srv.hub.Register(testUserID); err != nil {
			t.Fatalf("Register() after disconnect: %v", err)
		}
	}
	if _, err := srv.hub.Register(testUserID); !errors.Is(err, realtime.ErrTooManyConnections) {
		t.Errorf("Register() over the limit error = %v, want ErrTooManyConnections", err)
	}
}

func TestCloseStatusFor(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantCode   websocket.StatusCode
		wantReason string
	}{
		{"slow client", realtime.ErrSlowClient, websocket.StatusTryAgainLater, "too slow"},
		{"hub closed", realtime.ErrHubClosed, websocket.StatusGoingAway, "server shutting down"},
		{"wrapped hub closed", errors.Join(errors.New("context"), realtime.ErrHubClosed), websocket.StatusGoingAway, "server shutting down"},
		{"anything else", errors.New("unexpected"), websocket.StatusInternalError, "internal error"},
		{"no error", nil, websocket.StatusInternalError, "internal error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			code, reason := closeStatusFor(tt.err)

			if code != tt.wantCode || reason != tt.wantReason {
				t.Errorf("closeStatusFor(%v) = %d %q, want %d %q", tt.err, code, reason, tt.wantCode, tt.wantReason)
			}
		})
	}
}

func TestWSWrongMethod(t *testing.T) {
	router := NewRouter(Deps{
		Env:      config.EnvDevelopment,
		DB:       fakePinger{},
		Sessions: &fakeWSSessions{},
	})
	req := httptest.NewRequest(http.MethodPost, wsPath, nil)
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("status = %d, want 405", rec.Code)
	}
	if got := rec.Header().Get("Allow"); got != http.MethodGet {
		t.Errorf("Allow = %q, want GET", got)
	}
}
