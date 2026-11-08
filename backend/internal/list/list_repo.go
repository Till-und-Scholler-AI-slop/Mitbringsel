package list

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"mitbringsel/internal/platform/db/sqlcgen"
)

// PostgresRepository implements Repository with the sqlc queries. It only
// translates types and errors; all rules live in the service.
type PostgresRepository struct {
	q *sqlcgen.Queries
}

// NewPostgresRepository returns a repository on the given queries. No
// transactions are needed: every method is a single statement.
func NewPostgresRepository(q *sqlcgen.Queries) *PostgresRepository {
	return &PostgresRepository{q: q}
}

var _ Repository = (*PostgresRepository)(nil)

func (r *PostgresRepository) Create(ctx context.Context, groupID uuid.UUID, name string) (List, error) {
	row, err := r.q.CreateList(ctx, sqlcgen.CreateListParams{GroupID: groupID, Name: name})
	if err != nil {
		return List{}, err
	}
	return fromRow(row), nil
}

func (r *PostgresRepository) Get(ctx context.Context, listID uuid.UUID) (List, error) {
	row, err := r.q.GetList(ctx, listID)
	if err != nil {
		return List{}, notFoundIfNoRows(err)
	}
	return fromRow(row), nil
}

func (r *PostgresRepository) ListForGroup(ctx context.Context, groupID uuid.UUID, includeArchived bool) ([]List, error) {
	rows, err := r.q.ListListsForGroup(ctx, sqlcgen.ListListsForGroupParams{GroupID: groupID, IncludeArchived: includeArchived})
	if err != nil {
		return nil, err
	}
	out := make([]List, len(rows))
	for i, row := range rows {
		out[i] = fromRow(row)
	}
	return out, nil
}

func (r *PostgresRepository) Rename(ctx context.Context, listID uuid.UUID, name string) (List, error) {
	row, err := r.q.RenameList(ctx, sqlcgen.RenameListParams{ID: listID, Name: name})
	if err != nil {
		return List{}, notFoundIfNoRows(err)
	}
	return fromRow(row), nil
}

func (r *PostgresRepository) SetArchived(ctx context.Context, listID uuid.UUID, archived bool) (List, error) {
	row, err := r.q.SetListArchived(ctx, sqlcgen.SetListArchivedParams{ID: listID, Archived: archived})
	if err != nil {
		return List{}, notFoundIfNoRows(err)
	}
	return fromRow(row), nil
}

func (r *PostgresRepository) Delete(ctx context.Context, listID uuid.UUID) error {
	n, err := r.q.DeleteList(ctx, listID)
	if err != nil {
		return err
	}
	if n == 0 {
		return fmt.Errorf("%w: no row affected", ErrNotFound)
	}
	return nil
}

func fromRow(row sqlcgen.List) List {
	return List{
		ID:         row.ID,
		GroupID:    row.GroupID,
		Name:       row.Name,
		ArchivedAt: row.ArchivedAt,
		CreatedAt:  row.CreatedAt,
		UpdatedAt:  row.UpdatedAt,
		ServerSeq:  row.ServerSeq,
	}
}

// notFoundIfNoRows turns pgx's "no row" into the domain error.
func notFoundIfNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
