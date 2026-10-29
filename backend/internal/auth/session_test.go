package auth

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

var (
	testStart  = time.Date(2026, time.January, 15, 12, 0, 0, 0, time.UTC)
	testUserID = uuid.MustParse("0190a8c4-0000-7000-8000-000000000001")
	errRepo    = errors.New("repository failure")
)

// fakeSessionRepo keeps sessions in a map. Like the real repository, Get
// returns ErrSessionNotFound for unknown hashes, so the service behaves the
// same against both.
type fakeSessionRepo struct {
	sessions map[string]Session
	touches  int
	// failWith, if set, is returned by every method.
	failWith error
}

func newFakeSessionRepo() *fakeSessionRepo {
	return &fakeSessionRepo{sessions: make(map[string]Session)}
}

// Byte slices cannot be map keys; their string conversion can.
func (r *fakeSessionRepo) Create(_ context.Context, s Session) error {
	if r.failWith != nil {
		return r.failWith
	}
	r.sessions[string(s.IDHash)] = s
	return nil
}

func (r *fakeSessionRepo) Get(_ context.Context, idHash []byte) (Session, error) {
	if r.failWith != nil {
		return Session{}, r.failWith
	}
	s, ok := r.sessions[string(idHash)]
	if !ok {
		return Session{}, ErrSessionNotFound
	}
	return s, nil
}

func (r *fakeSessionRepo) Touch(_ context.Context, idHash []byte, lastSeenAt, expiresAt time.Time) error {
	if r.failWith != nil {
		return r.failWith
	}
	r.touches++
	s := r.sessions[string(idHash)]
	s.LastSeenAt = lastSeenAt
	s.ExpiresAt = expiresAt
	r.sessions[string(idHash)] = s
	return nil
}

func (r *fakeSessionRepo) Delete(_ context.Context, idHash []byte) error {
	if r.failWith != nil {
		return r.failWith
	}
	delete(r.sessions, string(idHash))
	return nil
}

// fakeClock is a clock that only moves when the test says so.
type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time          { return c.now }
func (c *fakeClock) Advance(d time.Duration) { c.now = c.now.Add(d) }

func newTestService() (*SessionService, *fakeSessionRepo, *fakeClock) {
	repo := newFakeSessionRepo()
	clock := &fakeClock{now: testStart}
	svc := NewSessionService(repo)
	// A method value: clock.Now bound to this clock, usable as func() time.Time.
	svc.now = clock.Now
	return svc, repo, clock
}

func TestSessionService_Create(t *testing.T) {
	svc, repo, _ := newTestService()

	token, expiresAt, err := svc.Create(context.Background(), testUserID)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if token == "" {
		t.Fatal("Create() returned an empty token")
	}
	if want := testStart.Add(sessionLifetime); !expiresAt.Equal(want) {
		t.Errorf("expiresAt = %v, want %v", expiresAt, want)
	}

	if len(repo.sessions) != 1 {
		t.Fatalf("repository holds %d sessions, want 1", len(repo.sessions))
	}
	sum := sha256.Sum256([]byte(token))
	stored, ok := repo.sessions[string(sum[:])]
	if !ok {
		t.Fatal("session is not stored under the SHA-256 of the token")
	}
	if bytes.Contains(stored.IDHash, []byte(token)) {
		t.Error("stored hash contains the plain token")
	}
	if stored.UserID != testUserID {
		t.Errorf("UserID = %v, want %v", stored.UserID, testUserID)
	}
	if !stored.ExpiresAt.Equal(expiresAt) {
		t.Errorf("stored ExpiresAt = %v, want %v", stored.ExpiresAt, expiresAt)
	}
	if !stored.LastSeenAt.Equal(testStart) {
		t.Errorf("LastSeenAt = %v, want %v", stored.LastSeenAt, testStart)
	}
}

func TestSessionService_Create_uniqueTokens(t *testing.T) {
	svc, _, _ := newTestService()

	first, _, err := svc.Create(context.Background(), testUserID)
	if err != nil {
		t.Fatalf("first Create() error = %v", err)
	}
	second, _, err := svc.Create(context.Background(), testUserID)
	if err != nil {
		t.Fatalf("second Create() error = %v", err)
	}
	if first == second {
		t.Error("two sessions got the same token")
	}
}

func TestSessionService_Create_repoError(t *testing.T) {
	svc, repo, _ := newTestService()
	repo.failWith = errRepo

	if _, _, err := svc.Create(context.Background(), testUserID); !errors.Is(err, errRepo) {
		t.Errorf("Create() error = %v, want %v", err, errRepo)
	}
}

func TestSessionService_Validate(t *testing.T) {
	tests := []struct {
		name string
		// age is how long after creation the session is validated.
		age         time.Duration
		wantErr     error
		wantTouched bool
	}{
		{name: "fresh session", age: 0},
		{name: "just before touch interval", age: touchInterval - time.Nanosecond},
		{name: "at touch interval", age: touchInterval, wantTouched: true},
		{name: "just before expiry", age: sessionLifetime - time.Nanosecond, wantTouched: true},
		{name: "at expiry", age: sessionLifetime, wantErr: ErrSessionNotFound},
		{name: "after expiry", age: sessionLifetime + time.Hour, wantErr: ErrSessionNotFound},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, repo, clock := newTestService()
			token, _, err := svc.Create(context.Background(), testUserID)
			if err != nil {
				t.Fatalf("Create() error = %v", err)
			}
			clock.Advance(tt.age)

			userID, renewedUntil, err := svc.Validate(context.Background(), token)

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("Validate() error = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr == nil && userID != testUserID {
				t.Errorf("Validate() = %v, want %v", userID, testUserID)
			}
			if got := repo.touches > 0; got != tt.wantTouched {
				t.Errorf("touched = %t, want %t", got, tt.wantTouched)
			}
			if tt.wantTouched {
				want := clock.Now().Add(sessionLifetime)
				stored := repo.sessions[string(hashToken(token))]
				if !stored.ExpiresAt.Equal(want) {
					t.Errorf("renewed ExpiresAt = %v, want %v", stored.ExpiresAt, want)
				}
				if !renewedUntil.Equal(want) {
					t.Errorf("renewedUntil = %v, want %v", renewedUntil, want)
				}
			} else if !renewedUntil.IsZero() {
				t.Errorf("renewedUntil = %v, want zero without renewal", renewedUntil)
			}
		})
	}
}

// TestSessionService_Validate_renewalExtendsLifetime checks the point of
// sliding expiry: a session in regular use outlives its original lifetime.
func TestSessionService_Validate_renewalExtendsLifetime(t *testing.T) {
	svc, _, clock := newTestService()
	token, _, err := svc.Create(context.Background(), testUserID)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	clock.Advance(sessionLifetime - time.Hour)
	if _, _, err := svc.Validate(context.Background(), token); err != nil {
		t.Fatalf("Validate() before original expiry: %v", err)
	}

	clock.Advance(2 * time.Hour)
	if _, _, err := svc.Validate(context.Background(), token); err != nil {
		t.Errorf("Validate() after original expiry: %v, want the renewed session to be valid", err)
	}
}

func TestSessionService_Validate_unknownToken(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "empty token", token: ""},
		{name: "token never issued", token: "NOT-A-REAL-TOKEN"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _, _ := newTestService()

			_, _, err := svc.Validate(context.Background(), tt.token)
			if !errors.Is(err, ErrSessionNotFound) {
				t.Errorf("Validate() error = %v, want %v", err, ErrSessionNotFound)
			}
		})
	}
}

func TestSessionService_Validate_touchError(t *testing.T) {
	svc, repo, clock := newTestService()
	token, _, err := svc.Create(context.Background(), testUserID)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	clock.Advance(touchInterval)
	repo.failWith = errRepo

	_, _, err = svc.Validate(context.Background(), token)
	if !errors.Is(err, errRepo) {
		t.Errorf("Validate() error = %v, want %v", err, errRepo)
	}
}

func TestSessionService_Delete(t *testing.T) {
	svc, _, _ := newTestService()
	token, _, err := svc.Create(context.Background(), testUserID)
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if err := svc.Delete(context.Background(), token); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if _, _, err := svc.Validate(context.Background(), token); !errors.Is(err, ErrSessionNotFound) {
		t.Errorf("Validate() after Delete() error = %v, want %v", err, ErrSessionNotFound)
	}
}

func TestSessionService_Delete_unknownToken(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "empty token", token: ""},
		{name: "token never issued", token: "NOT-A-REAL-TOKEN"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _, _ := newTestService()

			if err := svc.Delete(context.Background(), tt.token); err != nil {
				t.Errorf("Delete() error = %v, want nil", err)
			}
		})
	}
}

func TestSessionService_Delete_repoError(t *testing.T) {
	svc, repo, _ := newTestService()
	repo.failWith = errRepo

	if err := svc.Delete(context.Background(), "SOME-TOKEN"); !errors.Is(err, errRepo) {
		t.Errorf("Delete() error = %v, want %v", err, errRepo)
	}
}
