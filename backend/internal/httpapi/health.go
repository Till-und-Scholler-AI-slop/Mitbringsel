package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"time"
)

// HealthPath is exported because the container healthcheck in cmd/server
// calls the same endpoint.
const HealthPath = "/api/v1/health"

const (
	statusOK          = "ok"
	healthPingTimeout = 2 * time.Second
)

// Pinger reports whether a dependency (the database) is reachable.
// The interface lives here, at the consumer: httpapi only needs Ping and
// does not know about pgx. *pgxpool.Pool satisfies it automatically.
type Pinger interface {
	Ping(ctx context.Context) error
}

type healthResponse struct {
	Status string `json:"status"`
}

func healthHandler(db Pinger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// A hanging database must not hang the health check with it.
		ctx, cancel := context.WithTimeout(r.Context(), healthPingTimeout)
		defer cancel()

		if err := db.Ping(ctx); err != nil {
			slog.Error("health check: database ping failed", "error", err)
			writeError(w, http.StatusServiceUnavailable, CodeDBUnavailable)
			return
		}
		writeJSON(w, http.StatusOK, healthResponse{Status: statusOK})
	}
}
