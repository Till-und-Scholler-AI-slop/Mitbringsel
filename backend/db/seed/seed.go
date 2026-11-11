// Package seed fills the development database with dummy data: a few users,
// groups, lists and items to try out sharing and live sync with. It writes
// through the same services as the server, so the data obeys every rule
// that real data does.
package seed

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"mitbringsel/internal/group"
	"mitbringsel/internal/item"
	"mitbringsel/internal/list"
	"mitbringsel/internal/platform/db/sqlcgen"
	"mitbringsel/internal/user"
)

// clockNode is the node of the clock that stamps the seeded items. It is
// fixed because there is only ever one seed process.
const clockNode = "seed"

// Summary tells what Run has created.
type Summary struct {
	Users  []user.User
	Groups int
	Lists  int
	Items  int
}

// seeder holds the services Run writes through.
type seeder struct {
	users   *user.Service
	groups  *group.Service
	invites *group.InviteService
	lists   *list.Service
	items   *item.Service
	clock   *item.Clock
	// userIDs maps the email of a seed user to their ID.
	userIDs map[string]uuid.UUID
}

// Run replaces the seed data: it signs in the seed users, deletes every group
// they own, and creates the groups, lists and items from data.go again.
//
// The users are kept (the sign-in only refreshes them), so their IDs and
// sessions stay valid. Everything else in the database is left alone, apart
// from groups owned by a seed user, which Run cannot tell from earlier seed
// data. There is no transaction around the whole run: an aborted run leaves
// partial data behind, and running again cleans it up.
func Run(ctx context.Context, pool *pgxpool.Pool) (Summary, error) {
	s, err := newSeeder(pool)
	if err != nil {
		return Summary{}, err
	}

	var summary Summary
	if summary.Users, err = s.signInUsers(ctx); err != nil {
		return Summary{}, err
	}
	if err := s.deleteOwnedGroups(ctx); err != nil {
		return Summary{}, err
	}
	for _, spec := range groupSpecs {
		lists, items, err := s.createGroup(ctx, spec)
		if err != nil {
			return Summary{}, fmt.Errorf("seed group %q: %w", spec.Name, err)
		}
		summary.Groups++
		summary.Lists += lists
		summary.Items += items
	}
	return summary, nil
}

// newSeeder wires the services by hand, like cmd/server/main.go does.
func newSeeder(pool *pgxpool.Pool) (*seeder, error) {
	queries := sqlcgen.New(pool)
	groupRepo := group.NewPostgresRepository(pool)
	lists := list.NewService(list.NewPostgresRepository(queries), groupRepo, nil)
	clock, err := item.NewClock(clockNode, time.Now)
	if err != nil {
		return nil, fmt.Errorf("create item clock: %w", err)
	}
	return &seeder{
		users:   user.NewService(user.NewPostgresRepository(queries)),
		groups:  group.NewService(groupRepo, nil),
		invites: group.NewInviteService(groupRepo, nil),
		lists:   lists,
		items:   item.NewService(item.NewPostgresRepository(pool), lists, nil),
		clock:   clock,
		userIDs: make(map[string]uuid.UUID),
	}, nil
}

// signInUsers creates the seed users, or refreshes them if they exist. The
// subject is the one the dev login uses, so logging in with the same email
// later gives the same user.
func (s *seeder) signInUsers(ctx context.Context) ([]user.User, error) {
	users := make([]user.User, 0, len(userSpecs))
	for _, spec := range userSpecs {
		u, err := s.users.SignIn(ctx, user.Identity{
			Subject: user.DevSubject(spec.Email),
			Email:   spec.Email,
			Name:    spec.Name,
		})
		if err != nil {
			return nil, fmt.Errorf("sign in %s: %w", spec.Email, err)
		}
		s.userIDs[spec.Email] = u.ID
		users = append(users, u)
	}
	return users, nil
}

// deleteOwnedGroups removes the groups the seed users own. Deleting a group
// also removes its members, invites, lists and items (ON DELETE CASCADE).
func (s *seeder) deleteOwnedGroups(ctx context.Context) error {
	for _, spec := range userSpecs {
		id := s.userIDs[spec.Email]
		groups, err := s.groups.List(ctx, id)
		if err != nil {
			return fmt.Errorf("list groups of %s: %w", spec.Email, err)
		}
		for _, g := range groups {
			if g.Role != group.RoleOwner {
				continue
			}
			if err := s.groups.Delete(ctx, id, g.ID); err != nil {
				return fmt.Errorf("delete group %q: %w", g.Name, err)
			}
		}
	}
	return nil
}

// createGroup creates one group with its members, lists and items and
// returns how many lists and items it made.
func (s *seeder) createGroup(ctx context.Context, spec groupSpec) (lists, items int, err error) {
	owner := s.userIDs[spec.Owner]
	created, err := s.groups.Create(ctx, owner, spec.Name)
	if err != nil {
		return 0, 0, fmt.Errorf("create group: %w", err)
	}

	for _, m := range spec.Members {
		if err := s.addMember(ctx, owner, created.ID, m); err != nil {
			return 0, 0, err
		}
	}

	for _, ls := range spec.Lists {
		n, err := s.createList(ctx, owner, created.ID, ls)
		if err != nil {
			return 0, 0, fmt.Errorf("seed list %q: %w", ls.Name, err)
		}
		lists++
		items += n
	}
	return lists, items, nil
}

// addMember brings a user into the group the way a person would: the owner
// creates an invite link, the user accepts it. The link is revoked right
// away, so no open invite stays behind.
func (s *seeder) addMember(ctx context.Context, owner, groupID uuid.UUID, m memberSpec) error {
	memberID := s.userIDs[m.Email]

	token, invite, err := s.invites.Create(ctx, owner, groupID)
	if err != nil {
		return fmt.Errorf("invite %s: %w", m.Email, err)
	}
	if _, err := s.invites.Accept(ctx, memberID, token); err != nil {
		return fmt.Errorf("accept invite of %s: %w", m.Email, err)
	}
	if err := s.invites.Revoke(ctx, owner, groupID, invite.ID); err != nil {
		return fmt.Errorf("revoke invite of %s: %w", m.Email, err)
	}

	// Accepting always makes a plain member; only the owner can promote.
	if m.Role != group.RoleMember {
		if err := s.groups.SetRole(ctx, owner, groupID, memberID, m.Role); err != nil {
			return fmt.Errorf("set role of %s: %w", m.Email, err)
		}
	}
	return nil
}

// createList creates the list and its items, then archives the list if the
// spec asks for it. The list is archived last, like a list that was in use
// before it was put away.
func (s *seeder) createList(ctx context.Context, owner, groupID uuid.UUID, spec listSpec) (int, error) {
	l, err := s.lists.Create(ctx, owner, groupID, spec.Name)
	if err != nil {
		return 0, fmt.Errorf("create list: %w", err)
	}

	for _, is := range spec.Items {
		if err := s.createItem(ctx, owner, l.ID, is); err != nil {
			return 0, fmt.Errorf("item %q: %w", is.Name, err)
		}
	}

	if spec.Archived {
		if _, err := s.lists.Archive(ctx, owner, l.ID); err != nil {
			return 0, fmt.Errorf("archive list: %w", err)
		}
	}
	return len(spec.Items), nil
}

// createItem adds the item as the list owner and, if the spec names a
// member, lets that member check it off.
func (s *seeder) createItem(ctx context.Context, owner, listID uuid.UUID, spec itemSpec) error {
	// UUIDv7 like the frontend uses for items it creates offline.
	id, err := uuid.NewV7()
	if err != nil {
		return fmt.Errorf("new item id: %w", err)
	}

	created, err := s.items.Create(ctx, owner, listID, spec.newItem(id), s.clock.Next())
	if err != nil {
		return fmt.Errorf("create: %w", err)
	}
	if spec.CheckedBy == "" {
		return nil
	}

	change := item.Change{Checked: item.Some(true)}
	if _, err := s.items.Update(ctx, s.userIDs[spec.CheckedBy], created.ID, change, s.clock.Next()); err != nil {
		return fmt.Errorf("check: %w", err)
	}
	return nil
}

// newItem converts the spec to what the item service takes, where a missing
// quantity, unit or note is a nil pointer.
func (i itemSpec) newItem(id uuid.UUID) item.NewItem {
	n := item.NewItem{ID: id, Name: i.Name}
	// i is a copy (value receiver), so taking the address of its fields
	// does not leak the shared spec.
	if i.Quantity > 0 {
		n.Quantity = &i.Quantity
	}
	if i.Unit != "" {
		n.Unit = &i.Unit
	}
	if i.Note != "" {
		n.Note = &i.Note
	}
	return n
}
