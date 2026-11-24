package group

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"tuolino/internal/platform/db/sqlcgen"
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

var (
	_ Repository       = (*PostgresRepository)(nil)
	_ InviteRepository = (*PostgresRepository)(nil)
)

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

func (r *PostgresRepository) CountOwned(ctx context.Context, userID uuid.UUID) (int, error) {
	n, err := r.q.CountOwnedGroups(ctx, userID)
	return int(n), err
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

func (r *PostgresRepository) CreateInvite(ctx context.Context, groupID, createdBy uuid.UUID, tokenHash []byte, expiresAt time.Time) (Invite, error) {
	row, err := r.q.CreateGroupInvite(ctx, sqlcgen.CreateGroupInviteParams{
		GroupID:   groupID,
		TokenHash: tokenHash,
		CreatedBy: &createdBy,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		return Invite{}, err
	}
	return Invite{
		ID:            row.ID,
		GroupID:       row.GroupID,
		CreatedAt:     row.CreatedAt,
		ExpiresAt:     row.ExpiresAt,
		CreatedBy:     row.CreatedBy,
		CreatedByName: deref(row.CreatedByName),
	}, nil
}

func (r *PostgresRepository) ListActiveInvites(ctx context.Context, groupID uuid.UUID, now time.Time) ([]Invite, error) {
	rows, err := r.q.ListActiveGroupInvites(ctx, sqlcgen.ListActiveGroupInvitesParams{GroupID: groupID, Now: now})
	if err != nil {
		return nil, err
	}
	out := make([]Invite, len(rows))
	for i, row := range rows {
		out[i] = Invite{
			ID:            row.ID,
			GroupID:       row.GroupID,
			CreatedAt:     row.CreatedAt,
			ExpiresAt:     row.ExpiresAt,
			CreatedBy:     row.CreatedBy,
			CreatedByName: deref(row.CreatedByName),
		}
	}
	return out, nil
}

func (r *PostgresRepository) CountActiveInvites(ctx context.Context, groupID uuid.UUID, now time.Time) (int, error) {
	n, err := r.q.CountActiveGroupInvites(ctx, sqlcgen.CountActiveGroupInvitesParams{GroupID: groupID, Now: now})
	return int(n), err
}

func (r *PostgresRepository) RevokeInvite(ctx context.Context, groupID, inviteID uuid.UUID, now time.Time) error {
	n, err := r.q.RevokeGroupInvite(ctx, sqlcgen.RevokeGroupInviteParams{ID: inviteID, GroupID: groupID, Now: &now})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrInviteNotFound
	}
	return nil
}

func (r *PostgresRepository) DeleteStaleInvites(ctx context.Context, cutoff time.Time) (int64, error) {
	return r.q.DeleteStaleGroupInvites(ctx, cutoff)
}

func (r *PostgresRepository) FindInvite(ctx context.Context, tokenHash []byte) (InviteTarget, error) {
	row, err := r.q.GetGroupInviteByTokenHash(ctx, tokenHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return InviteTarget{}, ErrInviteNotFound
	}
	if err != nil {
		return InviteTarget{}, err
	}
	return InviteTarget{
		Group:              fromRow(row.Group),
		InvitedBy:          deref(row.InvitedBy),
		InvitedByAvatarURL: deref(row.InvitedByAvatarUrl),
		ExpiresAt:          row.ExpiresAt,
		Revoked:            row.RevokedAt != nil,
	}, nil
}

func (r *PostgresRepository) PreviewMembers(ctx context.Context, groupID uuid.UUID, max int) (int, []PreviewMember, error) {
	count, err := r.q.CountGroupMembers(ctx, groupID)
	if err != nil {
		return 0, nil, err
	}
	rows, err := r.q.ListGroupMembersPreview(ctx, sqlcgen.ListGroupMembersPreviewParams{GroupID: groupID, MaxRows: int32(max)})
	if err != nil {
		return 0, nil, err
	}
	members := make([]PreviewMember, len(rows))
	for i, row := range rows {
		members[i] = PreviewMember{FirstName: firstName(row.DisplayName), AvatarURL: deref(row.AvatarURL)}
	}
	return int(count), members, nil
}

func (r *PostgresRepository) AddMemberIfAbsent(ctx context.Context, groupID, userID uuid.UUID, role Role) (bool, error) {
	n, err := r.q.AddGroupMemberIfAbsent(ctx, sqlcgen.AddGroupMemberIfAbsentParams{
		GroupID: groupID,
		UserID:  userID,
		Role:    string(role),
	})
	return n == 1, err
}

// deref turns a nullable text column into "" for NULL.
func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
