package group

import (
	"context"
	"errors"
	"fmt"

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

// NewPostgresRepository takes the pool itself, unlike the user and session
// repositories: InTx needs it to begin transactions.
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

func (r *PostgresRepository) Lock(ctx context.Context, groupID uuid.UUID) error {
	_, err := r.q.LockGroup(ctx, groupID)
	return notFoundIfNoRows(err)
}

func (r *PostgresRepository) Create(ctx context.Context, name string, createdBy uuid.UUID) (Group, error) {
	row, err := r.q.CreateGroup(ctx, sqlcgen.CreateGroupParams{Name: name, CreatedBy: &createdBy})
	if err != nil {
		return Group{}, err
	}
	return fromRow(row), nil
}

func (r *PostgresRepository) Get(ctx context.Context, groupID uuid.UUID) (Group, error) {
	row, err := r.q.GetGroup(ctx, groupID)
	if err != nil {
		return Group{}, notFoundIfNoRows(err)
	}
	return fromRow(row), nil
}

func (r *PostgresRepository) Rename(ctx context.Context, groupID uuid.UUID, name string) (Group, error) {
	row, err := r.q.RenameGroup(ctx, sqlcgen.RenameGroupParams{ID: groupID, Name: name})
	if err != nil {
		return Group{}, notFoundIfNoRows(err)
	}
	return fromRow(row), nil
}

func (r *PostgresRepository) Delete(ctx context.Context, groupID uuid.UUID) error {
	n, err := r.q.DeleteGroup(ctx, groupID)
	return notFoundIfNone(n, err)
}

func (r *PostgresRepository) ListForUser(ctx context.Context, userID uuid.UUID) ([]Membership, error) {
	rows, err := r.q.ListGroupsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]Membership, len(rows))
	for i, row := range rows {
		out[i] = Membership{Group: fromRow(row.Group), Role: Role(row.Role)}
	}
	return out, nil
}

func (r *PostgresRepository) Members(ctx context.Context, groupIDs []uuid.UUID) (map[uuid.UUID][]Member, error) {
	rows, err := r.q.ListGroupMembers(ctx, groupIDs)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID][]Member, len(groupIDs))
	for _, row := range rows {
		m := Member{
			UserID:      row.UserID,
			DisplayName: row.DisplayName,
			Role:        Role(row.Role),
			JoinedAt:    row.JoinedAt,
		}
		if row.AvatarURL != nil {
			m.AvatarURL = *row.AvatarURL
		}
		out[row.GroupID] = append(out[row.GroupID], m)
	}
	return out, nil
}

func (r *PostgresRepository) MemberRole(ctx context.Context, groupID, userID uuid.UUID) (Role, error) {
	role, err := r.q.GetGroupMemberRole(ctx, sqlcgen.GetGroupMemberRoleParams{GroupID: groupID, UserID: userID})
	if err != nil {
		return "", notFoundIfNoRows(err)
	}
	return Role(role), nil
}

func (r *PostgresRepository) CountOwners(ctx context.Context, groupID uuid.UUID) (int, error) {
	n, err := r.q.CountGroupOwners(ctx, groupID)
	return int(n), err
}

func (r *PostgresRepository) AddMember(ctx context.Context, groupID, userID uuid.UUID, role Role) error {
	return r.q.AddGroupMember(ctx, sqlcgen.AddGroupMemberParams{GroupID: groupID, UserID: userID, Role: string(role)})
}

func (r *PostgresRepository) RemoveMember(ctx context.Context, groupID, userID uuid.UUID) error {
	n, err := r.q.RemoveGroupMember(ctx, sqlcgen.RemoveGroupMemberParams{GroupID: groupID, UserID: userID})
	return notFoundIfNone(n, err)
}

func (r *PostgresRepository) SetRole(ctx context.Context, groupID, userID uuid.UUID, role Role) error {
	n, err := r.q.SetGroupMemberRole(ctx, sqlcgen.SetGroupMemberRoleParams{
		GroupID: groupID,
		UserID:  userID,
		Role:    string(role),
	})
	return notFoundIfNone(n, err)
}

func fromRow(row sqlcgen.Group) Group {
	return Group{ID: row.ID, Name: row.Name, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
}

// notFoundIfNoRows turns pgx's "no row" into the domain error.
func notFoundIfNoRows(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// notFoundIfNone treats an UPDATE or DELETE that hit no row as not found.
func notFoundIfNone(rowsAffected int64, err error) error {
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("%w: no row affected", ErrNotFound)
	}
	return nil
}
