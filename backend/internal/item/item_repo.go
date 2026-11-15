package item

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mitbringsel/internal/platform/db/sqlcgen"
)

// txStarter is the part of *pgxpool.Pool that begins transactions.
type txStarter interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// PostgresRepository implements Repository with the sqlc queries. It only
// translates types and errors; all rules live in the service.
type PostgresRepository struct {
	// db starts transactions. It is nil inside a transaction, where InTx
	// joins the running one instead of starting another.
	db txStarter
	q  *sqlcgen.Queries
}

// NewPostgresRepository takes the pool itself: InTx needs it to begin
// transactions.
func NewPostgresRepository(pool *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{db: pool, q: sqlcgen.New(pool)}
}

var _ Repository = (*PostgresRepository)(nil)

func (r *PostgresRepository) InTx(ctx context.Context, fn func(tx Repository) error) error {
	if r.db == nil {
		return fn(r)
	}
	// BeginFunc commits if fn returns nil and rolls back otherwise, also
	// when fn panics.
	return pgx.BeginFunc(ctx, r.db, func(tx pgx.Tx) error {
		return fn(&PostgresRepository{q: r.q.WithTx(tx)})
	})
}

func (r *PostgresRepository) Create(ctx context.Context, it Item) (Item, error) {
	clocks, err := json.Marshal(it.Clocks)
	if err != nil {
		return Item{}, fmt.Errorf("marshal clocks: %w", err)
	}
	row, err := r.q.CreateItem(ctx, sqlcgen.CreateItemParams{
		ID:          it.ID,
		ListID:      it.ListID,
		Name:        it.Name,
		Quantity:    it.Quantity,
		Unit:        unitToText(it.Unit),
		Note:        it.Note,
		CreatedBy:   it.CreatedBy,
		FieldClocks: clocks,
	})
	// ON CONFLICT DO NOTHING returns no row when the ID exists.
	if errors.Is(err, pgx.ErrNoRows) {
		return Item{}, ErrIDTaken
	}
	if err != nil {
		return Item{}, err
	}
	return fromRow(row)
}

func (r *PostgresRepository) Get(ctx context.Context, itemID uuid.UUID) (Item, error) {
	row, err := r.q.GetItem(ctx, itemID)
	if err != nil {
		return Item{}, notFoundIfNoRows(err)
	}
	return fromRow(row)
}

func (r *PostgresRepository) GetForUpdate(ctx context.Context, itemID uuid.UUID) (Item, error) {
	row, err := r.q.GetItemForUpdate(ctx, itemID)
	if err != nil {
		return Item{}, notFoundIfNoRows(err)
	}
	return fromRow(row)
}

func (r *PostgresRepository) ListForList(ctx context.Context, listID uuid.UUID) ([]Item, error) {
	rows, err := r.q.ListItemsForList(ctx, listID)
	if err != nil {
		return nil, err
	}
	return fromRows(rows)
}

func (r *PostgresRepository) ListForLists(ctx context.Context, listIDs []uuid.UUID) ([]Item, error) {
	rows, err := r.q.ListItemsForLists(ctx, listIDs)
	if err != nil {
		return nil, err
	}
	return fromRows(rows)
}

func (r *PostgresRepository) Apply(ctx context.Context, itemID uuid.UUID, u Update) (Item, error) {
	clocks, err := json.Marshal(u.Clocks)
	if err != nil {
		return Item{}, fmt.Errorf("marshal clocks: %w", err)
	}
	row, err := r.q.ApplyItemUpdate(ctx, sqlcgen.ApplyItemUpdateParams{
		ID:          itemID,
		SetName:     u.Name.Set,
		Name:        u.Name.Value,
		SetQuantity: u.Quantity.Set,
		Quantity:    u.Quantity.Value,
		SetUnit:     u.Unit.Set,
		Unit:        unitToText(u.Unit.Value),
		SetNote:     u.Note.Set,
		Note:        u.Note.Value,
		SetChecked:  u.Checked.Set,
		Checked:     u.Checked.Value,
		CheckedBy:   u.CheckedBy,
		CheckedAt:   u.CheckedAt,
		Clocks:      clocks,
	})
	if err != nil {
		return Item{}, notFoundIfNoRows(err)
	}
	return fromRow(row)
}

func (r *PostgresRepository) MarkDeleted(ctx context.Context, itemID uuid.UUID) (Item, error) {
	row, err := r.q.MarkItemDeleted(ctx, itemID)
	if err != nil {
		return Item{}, notFoundIfNoRows(err)
	}
	return fromRow(row)
}

func (r *PostgresRepository) MarkCheckedDeleted(ctx context.Context, listID uuid.UUID, itemIDs []uuid.UUID) ([]Item, error) {
	rows, err := r.q.MarkCheckedItemsDeleted(ctx, sqlcgen.MarkCheckedItemsDeletedParams{
		ListID:  listID,
		ItemIds: itemIDs,
	})
	if err != nil {
		return nil, err
	}
	return fromRows(rows)
}

func (r *PostgresRepository) DeleteTombstones(ctx context.Context, cutoff time.Time) (int64, error) {
	return r.q.DeleteItemTombstones(ctx, cutoff)
}

func fromRow(row sqlcgen.Item) (Item, error) {
	var clocks Clocks
	if err := json.Unmarshal(row.FieldClocks, &clocks); err != nil {
		return Item{}, fmt.Errorf("unmarshal clocks of item %s: %w", row.ID, err)
	}
	var unit *Unit
	if row.Unit != nil {
		u := Unit(*row.Unit)
		unit = &u
	}
	return Item{
		ID:        row.ID,
		ListID:    row.ListID,
		Name:      row.Name,
		Quantity:  row.Quantity,
		Unit:      unit,
		Note:      row.Note,
		Checked:   row.Checked,
		CheckedBy: row.CheckedBy,
		CheckedAt: row.CheckedAt,
		CreatedBy: row.CreatedBy,
		CreatedAt: row.CreatedAt,
		DeletedAt: row.DeletedAt,
		Clocks:    clocks,
		ServerSeq: row.ServerSeq,
	}, nil
}

// fromRows translates every row with fromRow.
func fromRows(rows []sqlcgen.Item) ([]Item, error) {
	out := make([]Item, len(rows))
	for i, row := range rows {
		var err error
		if out[i], err = fromRow(row); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func unitToText(u *Unit) *string {
	if u == nil {
		return nil
	}
	s := string(*u)
	return &s
}

// notFoundIfNoRows turns pgx's "no row" into the domain error.
func notFoundIfNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
