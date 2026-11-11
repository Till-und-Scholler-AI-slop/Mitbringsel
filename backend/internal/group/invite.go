package group

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	// inviteLifetime is how long a link works (docs/auth.md).
	inviteLifetime = 7 * 24 * time.Hour
	// MaxActiveInvites caps the links a group can have open at once, so
	// nobody can fill the table by creating links in a loop.
	MaxActiveInvites = 10
	// PreviewMemberLimit is how many members the public invite preview
	// names. The full list stays behind the login, so a leaked link does
	// not give away everybody in the group.
	PreviewMemberLimit = 4
	// inviteTokenBytes is the size of the secret in a link: 256 bits, far
	// above the 128 bits that docs/auth.md asks for.
	inviteTokenBytes = 32
)

var (
	// ErrInviteNotFound means no invite has this token (or, when revoking,
	// the group has no such active invite).
	ErrInviteNotFound = errors.New("invite not found")
	// ErrInviteExpired means the invite existed but is revoked or past its
	// expiry. Tokens cannot be guessed, so telling this apart from "not
	// found" gives nothing away and lets the UI explain what happened.
	ErrInviteExpired = errors.New("invite expired or revoked")
	// ErrTooManyInvites means the group has MaxActiveInvites open links.
	ErrTooManyInvites = errors.New("too many active invites")
)

// Invite is an active invite as managers see it. The token is not part of
// it: only its hash is stored, so the link exists only for whoever created
// it, once.
type Invite struct {
	ID        uuid.UUID
	GroupID   uuid.UUID
	CreatedAt time.Time
	ExpiresAt time.Time
	// CreatedByName is empty if the creator deleted their account.
	CreatedByName string
}

// InviteTarget is what an invite token points to.
type InviteTarget struct {
	Group Group
	// InvitedBy is the display name of whoever created the invite, empty if
	// they deleted their account. InvitedByAvatarURL is empty if they have
	// no avatar.
	InvitedBy          string
	InvitedByAvatarURL string
	ExpiresAt          time.Time
	// Revoked is true once a manager withdrew the invite.
	Revoked bool
}

// PreviewMember is a member as the public invite preview shows them: first
// name and avatar, nothing that identifies the account.
type PreviewMember struct {
	FirstName string
	// AvatarURL is empty if the member has no avatar.
	AvatarURL string
}

// InvitePreview is what someone sees who holds a valid token but has not
// joined yet.
type InvitePreview struct {
	GroupName          string
	InvitedBy          string
	InvitedByAvatarURL string
	ExpiresAt          time.Time
	// MemberCount counts all members; Members names only the first
	// PreviewMemberLimit of them.
	MemberCount int
	Members     []PreviewMember
}

// InviteRepository stores invites. Like Repository it lives here, at the
// consumer, so the service can be tested with a fake.
type InviteRepository interface {
	// MemberRole returns ErrNotFound if the user is not in the group.
	MemberRole(ctx context.Context, groupID, userID uuid.UUID) (Role, error)

	CreateInvite(ctx context.Context, groupID, createdBy uuid.UUID, tokenHash []byte, expiresAt time.Time) (Invite, error)
	// ListActiveInvites returns the invites that are not revoked and expire
	// after now, newest first.
	ListActiveInvites(ctx context.Context, groupID uuid.UUID, now time.Time) ([]Invite, error)
	CountActiveInvites(ctx context.Context, groupID uuid.UUID, now time.Time) (int, error)
	// RevokeInvite returns ErrInviteNotFound if the group has no such
	// invite or it is revoked already.
	RevokeInvite(ctx context.Context, groupID, inviteID uuid.UUID, now time.Time) error
	// FindInvite returns ErrInviteNotFound if no invite has this hash.
	FindInvite(ctx context.Context, tokenHash []byte) (InviteTarget, error)
	// PreviewMembers returns the number of members and the first max of
	// them, oldest membership first.
	PreviewMembers(ctx context.Context, groupID uuid.UUID, max int) (count int, members []PreviewMember, err error)
	// AddMemberIfAbsent makes the user a member, or does nothing if they
	// already are one (their role stays). added tells which of the two
	// happened.
	AddMemberIfAbsent(ctx context.Context, groupID, userID uuid.UUID, role Role) (added bool, err error)
}

// InviteService creates, lists, revokes and redeems invite links.
type InviteService struct {
	repo InviteRepository
	pub  Publisher
	// now is a field so tests can move the clock past an expiry.
	now func() time.Time
}

// NewInviteService returns a service that uses the real clock. pub is told
// about every new member; nil means nobody listens.
func NewInviteService(repo InviteRepository, pub Publisher) *InviteService {
	if pub == nil {
		pub = noPublisher{}
	}
	return &InviteService{repo: repo, pub: pub, now: time.Now}
}

// Create makes a new invite. Owner and admins only. It returns the token for
// the link next to the invite; the token cannot be read again later.
func (s *InviteService) Create(ctx context.Context, actor, groupID uuid.UUID) (string, Invite, error) {
	if err := requireManager(ctx, s.repo, groupID, actor); err != nil {
		return "", Invite{}, err
	}

	now := s.now()
	// Two creators at the same moment can both pass this check and exceed
	// the limit by one. The limit only keeps the table small, so that is
	// not worth a lock.
	open, err := s.repo.CountActiveInvites(ctx, groupID, now)
	if err != nil {
		return "", Invite{}, fmt.Errorf("count invites: %w", err)
	}
	if open >= MaxActiveInvites {
		return "", Invite{}, ErrTooManyInvites
	}

	token, err := newInviteToken()
	if err != nil {
		return "", Invite{}, err
	}
	invite, err := s.repo.CreateInvite(ctx, groupID, actor, hashInviteToken(token), now.Add(inviteLifetime))
	if err != nil {
		return "", Invite{}, fmt.Errorf("create invite: %w", err)
	}
	return token, invite, nil
}

// List returns the active invites of the group. Owner and admins only.
func (s *InviteService) List(ctx context.Context, actor, groupID uuid.UUID) ([]Invite, error) {
	if err := requireManager(ctx, s.repo, groupID, actor); err != nil {
		return nil, err
	}
	invites, err := s.repo.ListActiveInvites(ctx, groupID, s.now())
	if err != nil {
		return nil, fmt.Errorf("list invites: %w", err)
	}
	return invites, nil
}

// Revoke withdraws an invite. Owner and admins only.
func (s *InviteService) Revoke(ctx context.Context, actor, groupID, inviteID uuid.UUID) error {
	if err := requireManager(ctx, s.repo, groupID, actor); err != nil {
		return err
	}
	if err := s.repo.RevokeInvite(ctx, groupID, inviteID, s.now()); err != nil {
		return fmt.Errorf("revoke invite: %w", err)
	}
	return nil
}

// Preview tells what a token points to, for the page that asks whether to
// join. It needs no login: whoever holds the token may see this much.
func (s *InviteService) Preview(ctx context.Context, token string) (InvitePreview, error) {
	target, err := s.resolve(ctx, token)
	if err != nil {
		return InvitePreview{}, err
	}
	count, members, err := s.repo.PreviewMembers(ctx, target.Group.ID, PreviewMemberLimit)
	if err != nil {
		return InvitePreview{}, fmt.Errorf("preview members: %w", err)
	}
	return InvitePreview{
		GroupName:          target.Group.Name,
		InvitedBy:          target.InvitedBy,
		InvitedByAvatarURL: target.InvitedByAvatarURL,
		ExpiresAt:          target.ExpiresAt,
		MemberCount:        count,
		Members:            members,
	}, nil
}

// Accept makes the actor a member of the invite's group and returns the
// group. Someone who is a member already stays what they are, so opening a
// link twice, or as an admin, changes nothing.
func (s *InviteService) Accept(ctx context.Context, actor uuid.UUID, token string) (Group, error) {
	target, err := s.resolve(ctx, token)
	if err != nil {
		return Group{}, err
	}
	added, err := s.repo.AddMemberIfAbsent(ctx, target.Group.ID, actor, RoleMember)
	if err != nil {
		return Group{}, fmt.Errorf("join group: %w", err)
	}
	// Only a new member is news; a repeated accept is not.
	if added {
		s.pub.MemberJoined(ctx, target.Group.ID, actor)
	}
	return target.Group, nil
}

// resolve finds the invite behind a token and checks that it still works.
func (s *InviteService) resolve(ctx context.Context, token string) (InviteTarget, error) {
	if token == "" {
		return InviteTarget{}, ErrInviteNotFound
	}
	target, err := s.repo.FindInvite(ctx, hashInviteToken(token))
	if err != nil {
		return InviteTarget{}, fmt.Errorf("find invite: %w", err)
	}
	// Not before expiry means expired, including the exact expiry instant.
	if target.Revoked || !s.now().Before(target.ExpiresAt) {
		return InviteTarget{}, ErrInviteExpired
	}
	return target, nil
}

// newInviteToken returns a random, URL-safe secret for an invite link.
func newInviteToken() (string, error) {
	b := make([]byte, inviteTokenBytes)
	// crypto/rand, not math/rand: the token is the only thing that keeps
	// strangers out of the group.
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate invite token: %w", err)
	}
	// RawURLEncoding uses only characters that are safe in a URL path and
	// leaves out the "=" padding.
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// hashInviteToken returns the SHA-256 of the token, for the same reason as
// session tokens: the token is random and long, so a plain hash is enough.
func hashInviteToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// firstName returns the first word of a display name: "Anna Müller" becomes
// "Anna". A name without a space is returned whole.
func firstName(displayName string) string {
	if first, _, found := strings.Cut(strings.TrimSpace(displayName), " "); found {
		return first
	}
	return strings.TrimSpace(displayName)
}
