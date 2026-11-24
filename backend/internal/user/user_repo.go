package user

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"tuolino/internal/platform/db/sqlcgen"
)

// PostgresRepository implements Repository with the sqlc queries. It only
// translates types and errors; all rules live in the service.
type PostgresRepository struct {
	q *sqlcgen.Queries
}

// NewPostgresRepository takes the sqlc queries instead of the pool, so a
// caller can later pass q.WithTx(tx) to run them inside a transaction.
func NewPostgresRepository(q *sqlcgen.Queries) *PostgresRepository {
	return &PostgresRepository{q: q}
}

var _ Repository = (*PostgresRepository)(nil)

func (r *PostgresRepository) Get(ctx context.Context, id uuid.UUID) (User, error) {
	row, err := r.q.GetUserByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err != nil {
		return User{}, err
	}
	return fromRow(row), nil
}

func (r *PostgresRepository) UpsertByGoogleSub(ctx context.Context, identity Identity) (User, error) {
	row, err := r.q.UpsertUserByGoogleSub(ctx, sqlcgen.UpsertUserByGoogleSubParams{
		GoogleSub:   identity.Subject,
		Email:       identity.Email,
		DisplayName: identity.Name,
		AvatarURL:   nullIfEmpty(identity.AvatarURL),
		NameGiven:   identity.nameGiven,
	})
	if err != nil {
		return User{}, err
	}
	return fromRow(row), nil
}

func fromRow(row sqlcgen.User) User {
	u := User{
		ID:          row.ID,
		Email:       row.Email,
		DisplayName: row.DisplayName,
		Locale:      Locale(row.Locale),
		Theme:       Theme(row.Theme),
		CreatedAt:   row.CreatedAt,
	}
	// sqlc maps the nullable column to *string; nil is SQL NULL.
	if row.AvatarURL != nil {
		u.AvatarURL = *row.AvatarURL
	}
	return u
}

// nullIfEmpty stores a missing avatar as NULL instead of an empty string, so
// the database has a single way to say "no avatar".
func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
