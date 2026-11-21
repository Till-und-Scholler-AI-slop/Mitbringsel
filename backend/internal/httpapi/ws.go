package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/google/uuid"

	"mitbringsel/internal/httpapi/apigen"
	"mitbringsel/internal/realtime"
)

const (
	wsPath = "/api/v1/ws"

	// wsReadLimit is the largest message a client may send. Only ping exists
	// today; phase 6 needs more room for mutate.
	wsReadLimit = 4 << 10 // 4 KiB
	// wsReadTimeout is how long a connection may stay silent. The client
	// pings every 25 seconds, so two missed pings end the connection.
	wsReadTimeout = 60 * time.Second
	// wsWriteTimeout is how long one message may take to leave the server.
	wsWriteTimeout = 10 * time.Second
	// wsMaxLifetime ends every connection after an hour, so the session is
	// checked again when the client reconnects.
	wsMaxLifetime = time.Hour
)

// wsConfig holds the durations of a connection. Tests shorten them.
type wsConfig struct {
	readTimeout, writeTimeout, maxLifetime time.Duration
}

var defaultWSConfig = wsConfig{
	readTimeout:  wsReadTimeout,
	writeTimeout: wsWriteTimeout,
	maxLifetime:  wsMaxLifetime,
}

// GroupIDLister returns the groups a user belongs to. *group.Service
// satisfies it through GroupService; tests use a fake.
type GroupIDLister interface {
	GroupIDs(ctx context.Context, actor uuid.UUID) ([]uuid.UUID, error)
}

// errInvalidMessage is returned by a message handler for input that breaks
// the protocol; the connection is closed with 1008.
var errInvalidMessage = errors.New("invalid message")

// wsMessageHandler handles one type of client message. payload is the raw
// "payload" field of the envelope, nil if there was none. A returned error
// closes the connection: errInvalidMessage with 1008 (policy violation),
// anything else with 1011 (internal error). Errors that the client should
// see and survive are sent as an error message with s.send, and the handler
// returns nil.
type wsMessageHandler func(ctx context.Context, s *wsSession, payload json.RawMessage) error

// wsHandlers maps the "type" of a client message to its handler. A new
// message type is a new entry, the read loop stays as it is.
type wsHandlers map[string]wsMessageHandler

// newWSHandlers returns the client messages the server understands.
func newWSHandlers() wsHandlers {
	return wsHandlers{
		string(apigen.PingMessageTypePing): handlePing,
	}
}

// handlePing answers the keep-alive of the client. The read loop already
// counts the message as a sign of life.
func handlePing(_ context.Context, s *wsSession, _ json.RawMessage) error {
	s.send(apigen.PongMessage{Type: apigen.PongMessageTypePong})
	return nil
}

// clientEnvelope is the frame around every client message. The ClientMessage
// union of the API contract is not generated (see oapi-codegen.yaml), so the
// type decides which handler gets the payload. json.RawMessage keeps the
// payload as bytes until that handler decodes it.
type clientEnvelope struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// wsSession is one open live connection and everything its two goroutines
// share.
type wsSession struct {
	userID   uuid.UUID
	hub      *realtime.Hub
	client   *realtime.Client
	conn     *websocket.Conn
	handlers wsHandlers
	cfg      wsConfig
	// readerDone is closed when readLoop returns. A closed channel can be
	// received from any number of times, so the writer and the handler both
	// wait on it.
	readerDone chan struct{}
}

// send queues msg for this connection only. The writer goroutine delivers it.
func (s *wsSession) send(msg any) {
	data, err := marshalMessage(msg)
	if err != nil {
		slog.Error("websocket: marshal message", "error", err)
		return
	}
	s.hub.SendToClient(s.client, data)
}

// marshalMessage encodes a server message (one of the generated types) for
// the wire. All server messages go through here, so they are encoded the
// same way.
func marshalMessage(msg any) ([]byte, error) {
	data, err := json.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("marshal %T: %w", msg, err)
	}
	return data, nil
}

// closeStatusFor translates the reason the hub dropped a connection (see
// realtime.Client.Err) into the close code and reason the client sees.
func closeStatusFor(err error) (websocket.StatusCode, string) {
	switch {
	case errors.Is(err, realtime.ErrHubClosed):
		return websocket.StatusGoingAway, "server shutting down"
	case errors.Is(err, realtime.ErrSlowClient):
		return websocket.StatusTryAgainLater, "too slow"
	default:
		return websocket.StatusInternalError, "internal error"
	}
}

// wsHandler upgrades the request to a WebSocket and serves it until either
// side ends it. It must run behind requireUser. The handler goroutine is the
// goroutine of the connection: ServeHTTP does not return before the
// connection is over, because the connection would be cut when it did.
func wsHandler(hub *realtime.Hub, groups GroupIDLister, publicBaseURL string, handlers wsHandlers, cfg wsConfig, active *sync.WaitGroup) http.HandlerFunc {
	// requireOrigin has already compared the Origin; the library checks it
	// once more and takes the patterns for hosts that may differ from the
	// Host header, which is the case behind the Vite proxy.
	var originPatterns []string
	if host := hostOf(publicBaseURL); host != "" {
		originPatterns = []string{host}
	}
	acceptOptions := &websocket.AcceptOptions{OriginPatterns: originPatterns}

	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := userIDFrom(r.Context())
		if !ok {
			slog.Error("websocket: no user in request context, route is missing requireUser")
			writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
			return
		}

		// Registered before the upgrade, so a refusal is still a normal HTTP
		// answer. The groups are loaded after Register, see Hub.Register.
		client, err := hub.Register(userID)
		switch {
		case errors.Is(err, realtime.ErrTooManyConnections):
			writeError(w, http.StatusTooManyRequests, apigen.ErrorCodeRateLimited)
			return
		case errors.Is(err, realtime.ErrHubClosed):
			writeError(w, http.StatusServiceUnavailable, apigen.ErrorCodeInternal)
			return
		case err != nil:
			slog.Error("websocket: register connection", "error", err)
			writeError(w, http.StatusInternalServerError, apigen.ErrorCodeInternal)
			return
		}
		// Tracked before websocket.Accept hijacks the connection: http.Server.Shutdown
		// waits for every non-hijacked request to return or hijack, so Add(1)
		// always happens before Shutdown returns and Wait begins.
		if active != nil {
			active.Add(1)
			defer active.Done()
		}
		// defer runs the calls in reverse order when the function returns:
		// cancel, CloseNow, Unregister, then Done, as declared bottom-up.
		defer hub.Unregister(client)

		// Accept answers the request itself if it refuses, so there is
		// nothing left to write here.
		conn, err := websocket.Accept(w, r, acceptOptions)
		if err != nil {
			slog.Info("websocket: upgrade refused", "error", err)
			return
		}
		// A no-op if the connection was closed properly before; the safety
		// net for every other way out of this function.
		defer func() { _ = conn.CloseNow() }()
		conn.SetReadLimit(wsReadLimit)

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		groupIDs, err := groups.GroupIDs(ctx, userID)
		if err != nil {
			slog.Error("websocket: load groups", "error", err)
			_ = conn.Close(websocket.StatusInternalError, "internal error")
			return
		}

		s := &wsSession{
			userID:     userID,
			hub:        hub,
			client:     client,
			conn:       conn,
			handlers:   handlers,
			cfg:        cfg,
			readerDone: make(chan struct{}),
		}
		hub.JoinInitialGroups(client, groupIDs)
		s.send(apigen.ReadyMessage{Type: apigen.ReadyMessageTypeReady})

		// A goroutine per connection: reading blocks until the client says
		// something, writing blocks until the hub has something to say, and
		// neither may wait for the other.
		go s.readLoop(ctx)
		s.writeLoop(ctx)

		// The writer is done, so stop the reader too and wait for it. The
		// handler must not return while a goroutine still uses the
		// connection.
		cancel()
		<-s.readerDone
	}
}

// readLoop reads client messages and passes them to their handlers until the
// connection ends. It runs in its own goroutine, and it is the only reader
// of the connection.
func (s *wsSession) readLoop(ctx context.Context) {
	defer close(s.readerDone)

	for {
		// A new timeout per message: every message, ping or not, shows the
		// client is alive. When it expires the library cuts the connection
		// without a close frame.
		readCtx, cancel := context.WithTimeout(ctx, s.cfg.readTimeout)
		typ, data, err := s.conn.Read(readCtx)
		cancel()
		if err != nil {
			// The client left, was silent for too long, sent too much (the
			// library has closed with 1009) or the server is stopping: none
			// of it needs a message of its own.
			slog.Debug("websocket: read ended", "error", err)
			return
		}

		if typ != websocket.MessageText {
			_ = s.conn.Close(websocket.StatusUnsupportedData, "text messages only")
			return
		}

		var env clientEnvelope
		if err := json.Unmarshal(data, &env); err != nil || env.Type == "" {
			_ = s.conn.Close(websocket.StatusPolicyViolation, "invalid message")
			return
		}

		handle, known := s.handlers[env.Type]
		if !known {
			// A client of another version may send what we do not know yet.
			// Tell it and carry on, the connection is still good.
			s.send(apigen.SocketErrorMessage{
				Type:    apigen.SocketErrorMessageTypeError,
				Payload: apigen.SocketErrorPayload{Code: apigen.ErrorCodeInvalidRequest},
			})
			continue
		}

		if err := handle(ctx, s, env.Payload); err != nil {
			if errors.Is(err, errInvalidMessage) {
				_ = s.conn.Close(websocket.StatusPolicyViolation, "invalid message")
			} else {
				slog.Error("websocket: handle message", "type", env.Type, "error", err)
				_ = s.conn.Close(websocket.StatusInternalError, "internal error")
			}
			return
		}
	}
}

// writeLoop moves messages from the hub to the client and ends the
// connection when the hub drops it or its lifetime is over. It runs in the
// handler goroutine and is the only writer that is not a close.
func (s *wsSession) writeLoop(ctx context.Context) {
	// The lifetime is a timer here and not a deadline on ctx: a context that
	// expires makes the library cut the connection without a close frame,
	// and the client could not tell that it should simply reconnect.
	lifetime := time.NewTimer(s.cfg.maxLifetime)
	defer lifetime.Stop()

	for {
		select {
		case msg := <-s.client.Send():
			writeCtx, cancel := context.WithTimeout(ctx, s.cfg.writeTimeout)
			err := s.conn.Write(writeCtx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				// The client is gone or too slow to take a message in
				// time; it will reconnect and reload.
				slog.Debug("websocket: write ended", "error", err)
				return
			}

		case <-s.client.Done():
			code, reason := closeStatusFor(s.client.Err())
			_ = s.conn.Close(code, reason)
			return

		case <-lifetime.C:
			_ = s.conn.Close(websocket.StatusGoingAway, "connection lifetime reached")
			return

		case <-s.readerDone:
			return

		case <-ctx.Done():
			return
		}
	}
}
