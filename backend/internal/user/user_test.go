package user

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

var errRepo = errors.New("repository failure")

// fakeRepo keeps users in a map keyed by subject. Like the real repository,
// Get returns ErrNotFound for unknown IDs and an upsert keeps the ID of an
// existing subject.
type fakeRepo struct {
	bySubject map[string]User
	// lastUpsert is the identity the service passed on, after normalising.
	lastUpsert Identity
	// failWith, if set, is returned by every method.
	failWith error
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{bySubject: make(map[string]User)}
}

func (r *fakeRepo) Get(_ context.Context, id uuid.UUID) (User, error) {
	if r.failWith != nil {
		return User{}, r.failWith
	}
	for _, u := range r.bySubject {
		if u.ID == id {
			return u, nil
		}
	}
	return User{}, ErrNotFound
}

func (r *fakeRepo) UpsertByGoogleSub(_ context.Context, identity Identity) (User, error) {
	if r.failWith != nil {
		return User{}, r.failWith
	}
	r.lastUpsert = identity
	u, ok := r.bySubject[identity.Subject]
	if !ok {
		u = User{ID: uuid.New(), Locale: LocaleDE, Theme: ThemeSystem}
	}
	u.Email = identity.Email
	u.DisplayName = identity.Name
	u.AvatarURL = identity.AvatarURL
	r.bySubject[identity.Subject] = u
	return u, nil
}

func TestService_SignIn(t *testing.T) {
	tests := []struct {
		name     string
		identity Identity
		// want is the identity the repository receives.
		want    Identity
		wantErr error
	}{
		{
			name:     "complete identity is stored as is",
			identity: Identity{Subject: "sub-1", Email: "anna@example.com", Name: "Anna", AvatarURL: "https://example.com/a.png"},
			want:     Identity{Subject: "sub-1", Email: "anna@example.com", Name: "Anna", AvatarURL: "https://example.com/a.png"},
		},
		{
			name:     "surrounding whitespace is trimmed",
			identity: Identity{Subject: " sub-1 ", Email: " anna@example.com ", Name: " Anna Müller ", AvatarURL: " https://example.com/a.png "},
			want:     Identity{Subject: "sub-1", Email: "anna@example.com", Name: "Anna Müller", AvatarURL: "https://example.com/a.png"},
		},
		{
			name:     "missing name falls back to email local part",
			identity: Identity{Subject: "sub-1", Email: "anna.mueller@example.com"},
			want:     Identity{Subject: "sub-1", Email: "anna.mueller@example.com", Name: "anna.mueller"},
		},
		{
			name:     "blank name falls back to email local part",
			identity: Identity{Subject: "sub-1", Email: "anna@example.com", Name: "   "},
			want:     Identity{Subject: "sub-1", Email: "anna@example.com", Name: "anna"},
		},
		{
			name:     "missing subject",
			identity: Identity{Email: "anna@example.com", Name: "Anna"},
			wantErr:  ErrInvalidIdentity,
		},
		{
			name:     "blank subject",
			identity: Identity{Subject: "  ", Email: "anna@example.com", Name: "Anna"},
			wantErr:  ErrInvalidIdentity,
		},
		{
			name:     "missing email",
			identity: Identity{Subject: "sub-1", Name: "Anna"},
			wantErr:  ErrInvalidIdentity,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := newFakeRepo()
			svc := NewService(repo)

			got, err := svc.SignIn(context.Background(), tt.identity)

			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("SignIn() error = %v, want %v", err, tt.wantErr)
			}
			if tt.wantErr != nil {
				if len(repo.bySubject) != 0 {
					t.Error("SignIn() stored a user despite invalid identity")
				}
				return
			}
			if repo.lastUpsert != tt.want {
				t.Errorf("repository got %+v, want %+v", repo.lastUpsert, tt.want)
			}
			if got.DisplayName != tt.want.Name {
				t.Errorf("DisplayName = %q, want %q", got.DisplayName, tt.want.Name)
			}
		})
	}
}

func TestService_SignIn_repoError(t *testing.T) {
	repo := newFakeRepo()
	repo.failWith = errRepo
	svc := NewService(repo)

	_, err := svc.SignIn(context.Background(), Identity{Subject: "sub-1", Email: "anna@example.com"})
	if !errors.Is(err, errRepo) {
		t.Errorf("SignIn() error = %v, want %v", err, errRepo)
	}
}

func TestDevSubject(t *testing.T) {
	tests := []struct {
		email string
		want  string
	}{
		{email: "anna@example.com", want: "dev:anna@example.com"},
		{email: "  anna@example.com\t", want: "dev:anna@example.com"},
		{email: "", want: "dev:"},
	}

	for _, tt := range tests {
		if got := DevSubject(tt.email); got != tt.want {
			t.Errorf("DevSubject(%q) = %q, want %q", tt.email, got, tt.want)
		}
	}
}

func TestService_Get(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)
	ctx := context.Background()

	created, err := svc.SignIn(ctx, Identity{Subject: "sub-1", Email: "anna@example.com", Name: "Anna"})
	if err != nil {
		t.Fatalf("SignIn() error = %v", err)
	}

	got, err := svc.Get(ctx, created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if got != created {
		t.Errorf("Get() = %+v, want %+v", got, created)
	}
}

func TestService_Get_errors(t *testing.T) {
	tests := []struct {
		name     string
		failWith error
		wantErr  error
	}{
		{name: "unknown id", wantErr: ErrNotFound},
		{name: "repository failure", failWith: errRepo, wantErr: errRepo},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := newFakeRepo()
			repo.failWith = tt.failWith
			svc := NewService(repo)

			if _, err := svc.Get(context.Background(), uuid.New()); !errors.Is(err, tt.wantErr) {
				t.Errorf("Get() error = %v, want %v", err, tt.wantErr)
			}
		})
	}
}
