// Package user holds the user domain: profiles and sign-in data.
package user

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Locale is the language the user chose for the UI.
type Locale string

const (
	LocaleDE Locale = "de"
	LocaleEN Locale = "en"
)

// Theme is the colour scheme the user chose for the UI.
type Theme string

const (
	ThemeLight  Theme = "light"
	ThemeDark   Theme = "dark"
	ThemeSystem Theme = "system"
)

var (
	// ErrNotFound means no user has the requested ID.
	ErrNotFound = errors.New("user not found")
	// ErrInvalidIdentity means a login provider sent data we cannot use to
	// identify a person.
	ErrInvalidIdentity = errors.New("invalid identity")
)

// User is a stored user. The Google subject is left out on purpose: only the
// sign-in needs it, so it can never end up in an API response by accident.
type User struct {
	ID          uuid.UUID
	Email       string
	DisplayName string
	// AvatarURL is empty if the user has no avatar.
	AvatarURL string
	Locale    Locale
	Theme     Theme
	CreatedAt time.Time
}

// Identity is what a login provider tells us about a person.
type Identity struct {
	// Subject is Google's stable account ID ("sub"). Unlike the email
	// address it never changes, so it is the key for finding the user.
	Subject   string
	Email     string
	Name      string
	AvatarURL string
}

// devSubjectPrefix keeps dev users apart from real accounts: Google subjects
// are plain digits and never start with it.
const devSubjectPrefix = "dev:"

// DevSubject returns the subject of the dev user with this email. The dev
// login and the seed data both use it, so they find the same users. The email
// is trimmed, so " anna@example.com" and "anna@example.com" are one user.
func DevSubject(email string) string {
	return devSubjectPrefix + strings.TrimSpace(email)
}

// Repository stores users. It lives here, at the consumer, so the service
// does not depend on pgx or sqlc and can be tested with a fake.
type Repository interface {
	// Get returns ErrNotFound if no user has this ID.
	Get(ctx context.Context, id uuid.UUID) (User, error)
	// UpsertByGoogleSub creates the user or updates email, name and avatar
	// of the user with the same subject. Locale and theme stay untouched.
	UpsertByGoogleSub(ctx context.Context, identity Identity) (User, error)
}

// Service reads users and keeps their profile in sync with the login
// provider.
type Service struct {
	repo Repository
}

// NewService returns a service backed by the given repository.
func NewService(repo Repository) *Service {
	return &Service{repo: repo}
}

// Get returns the user with the given ID, or an error wrapping ErrNotFound.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (User, error) {
	u, err := s.repo.Get(ctx, id)
	if err != nil {
		return User{}, fmt.Errorf("get user: %w", err)
	}
	return u, nil
}

// SignIn creates the user on first login and refreshes their profile on
// every later one.
func (s *Service) SignIn(ctx context.Context, identity Identity) (User, error) {
	identity, err := normalizeIdentity(identity)
	if err != nil {
		return User{}, err
	}

	u, err := s.repo.UpsertByGoogleSub(ctx, identity)
	if err != nil {
		return User{}, fmt.Errorf("upsert user: %w", err)
	}
	return u, nil
}

// normalizeIdentity trims all fields and fills in a display name if the
// provider sent none, because the UI always needs something to show.
func normalizeIdentity(identity Identity) (Identity, error) {
	identity.Subject = strings.TrimSpace(identity.Subject)
	identity.Email = strings.TrimSpace(identity.Email)
	identity.Name = strings.TrimSpace(identity.Name)
	identity.AvatarURL = strings.TrimSpace(identity.AvatarURL)

	if identity.Subject == "" {
		return Identity{}, fmt.Errorf("%w: subject is empty", ErrInvalidIdentity)
	}
	if identity.Email == "" {
		return Identity{}, fmt.Errorf("%w: email is empty", ErrInvalidIdentity)
	}

	if identity.Name == "" {
		// strings.Cut splits at the first "@". Without one, local is the
		// whole address, which is still a usable name.
		local, _, _ := strings.Cut(identity.Email, "@")
		identity.Name = local
	}
	return identity, nil
}
