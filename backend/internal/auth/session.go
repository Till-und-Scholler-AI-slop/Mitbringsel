// Package auth handles sessions, the Google login and the auth middleware.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const (
	sessionLifetime = 30 * 24 * time.Hour
	// Renewing on every request would turn each read into a database write.
	// Renewing at most hourly shifts the expiry by at most an hour.
	touchInterval = time.Hour
)

// ErrSessionNotFound covers unknown, expired and empty tokens alike, so
// callers cannot tell them apart and neither can an attacker.
var ErrSessionNotFound = errors.New("session not found")

// Session is a stored session. Only the hash of the token is kept; the token
// itself exists only in the user's cookie.
type Session struct {
	IDHash     []byte
	UserID     uuid.UUID
	ExpiresAt  time.Time
	LastSeenAt time.Time
}

// SessionRepository stores sessions. It lives here, at the consumer, so the
// service does not depend on pgx or sqlc and can be tested with a fake.
type SessionRepository interface {
	Create(ctx context.Context, s Session) error
	// Get returns ErrSessionNotFound if no session has this hash.
	Get(ctx context.Context, idHash []byte) (Session, error)
	Touch(ctx context.Context, idHash []byte, lastSeenAt, expiresAt time.Time) error
	Delete(ctx context.Context, idHash []byte) error
}

// SessionService creates, validates and deletes sessions.
type SessionService struct {
	repo SessionRepository
	// now is a field instead of a direct time.Now call so tests can control
	// the clock and check expiry without waiting.
	now func() time.Time
}

// NewSessionService returns a service that uses the real clock.
func NewSessionService(repo SessionRepository) *SessionService {
	return &SessionService{repo: repo, now: time.Now}
}

// Create starts a session for the user and returns the token for the cookie
// together with its expiry.
func (s *SessionService) Create(ctx context.Context, userID uuid.UUID) (string, time.Time, error) {
	// rand.Text returns 128 random bits, base32-encoded: meant for secrets.
	token := rand.Text()
	now := s.now()
	expiresAt := now.Add(sessionLifetime)

	err := s.repo.Create(ctx, Session{
		IDHash:     hashToken(token),
		UserID:     userID,
		ExpiresAt:  expiresAt,
		LastSeenAt: now,
	})
	if err != nil {
		return "", time.Time{}, fmt.Errorf("create session: %w", err)
	}
	return token, expiresAt, nil
}

// Validate returns the user the token belongs to and renews the session if
// it has not been renewed within touchInterval.
func (s *SessionService) Validate(ctx context.Context, token string) (uuid.UUID, error) {
	if token == "" {
		return uuid.Nil, ErrSessionNotFound
	}

	idHash := hashToken(token)
	session, err := s.repo.Get(ctx, idHash)
	if err != nil {
		// %w keeps ErrSessionNotFound recognisable for errors.Is.
		return uuid.Nil, fmt.Errorf("get session: %w", err)
	}

	now := s.now()
	// Not before expiry means expired, including the exact expiry instant.
	if !now.Before(session.ExpiresAt) {
		return uuid.Nil, ErrSessionNotFound
	}

	if now.Sub(session.LastSeenAt) >= touchInterval {
		if err := s.repo.Touch(ctx, idHash, now, now.Add(sessionLifetime)); err != nil {
			return uuid.Nil, fmt.Errorf("touch session: %w", err)
		}
	}
	return session.UserID, nil
}

// Delete ends the session (logout). An unknown token is not an error: the
// user is logged out either way.
func (s *SessionService) Delete(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	if err := s.repo.Delete(ctx, hashToken(token)); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

// hashToken returns the SHA-256 of the token. A plain hash without salt is
// enough here: the token is random and long, so it cannot be guessed from a
// table of common values the way a password could.
func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	// Sum256 returns a fixed-size array; [:] turns it into the slice pgx
	// needs for bytea.
	return sum[:]
}
