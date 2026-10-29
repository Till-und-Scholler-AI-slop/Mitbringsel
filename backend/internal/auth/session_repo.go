package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mitbringsel/internal/platform/db/sqlcgen"
)

// PostgresSessionRepository implements SessionRepository with the sqlc
// queries. It only translates types and errors; all rules live in the
// service.
type PostgresSessionRepository struct {
	q *sqlcgen.Queries
}

// NewPostgresSessionRepository takes the sqlc queries instead of the pool, so
// a caller can later pass q.WithTx(tx) to run them inside a transaction.
func NewPostgresSessionRepository(q *sqlcgen.Queries) *PostgresSessionRepository {
	return &PostgresSessionRepository{q: q}
}

// Compile-time check that the type satisfies the interface: the build fails
// here, not at the first caller, if a method is missing or has the wrong
// signature.
var _ SessionRepository = (*PostgresSessionRepository)(nil)

func (r *PostgresSessionRepository) Create(ctx context.Context, s Session) error {
	return r.q.CreateSession(ctx, sqlcgen.CreateSessionParams{
		IDHash:     s.IDHash,
		UserID:     s.UserID,
		ExpiresAt:  s.ExpiresAt,
		LastSeenAt: s.LastSeenAt,
	})
}

func (r *PostgresSessionRepository) Get(ctx context.Context, idHash []byte) (Session, error) {
	row, err := r.q.GetSession(ctx, idHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrSessionNotFound
	}
	if err != nil {
		return Session{}, err
	}
	return Session{
		IDHash:     row.IDHash,
		UserID:     row.UserID,
		ExpiresAt:  row.ExpiresAt,
		LastSeenAt: row.LastSeenAt,
	}, nil
}

func (r *PostgresSessionRepository) Touch(ctx context.Context, idHash []byte, lastSeenAt, expiresAt time.Time) error {
	return r.q.TouchSession(ctx, sqlcgen.TouchSessionParams{
		IDHash:     idHash,
		LastSeenAt: lastSeenAt,
		ExpiresAt:  expiresAt,
	})
}

func (r *PostgresSessionRepository) Delete(ctx context.Context, idHash []byte) error {
	return r.q.DeleteSession(ctx, idHash)
}
