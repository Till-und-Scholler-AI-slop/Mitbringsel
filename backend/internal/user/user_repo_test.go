package user

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"tuolino/internal/platform/db/dbtest"
	"tuolino/internal/platform/db/sqlcgen"
)

// TestPostgresRepository shares one container across its subtests, because
// starting PostgreSQL takes seconds. Each subtest uses its own subject, so
// the subtests stay independent of each other.
func TestPostgresRepository(t *testing.T) {
	pool := dbtest.NewPool(t)
	repo := NewPostgresRepository(sqlcgen.New(pool))
	ctx := context.Background()

	t.Run("upsert creates user with defaults", func(t *testing.T) {
		identity := testIdentity("create")

		got, err := repo.UpsertByGoogleSub(ctx, identity)
		if err != nil {
			t.Fatalf("UpsertByGoogleSub() error = %v", err)
		}
		if got.ID == uuid.Nil {
			t.Error("ID is not set")
		}
		if got.CreatedAt.IsZero() {
			t.Error("CreatedAt is not set")
		}
		assertProfile(t, got, identity)
		if got.Locale != LocaleDE {
			t.Errorf("Locale = %q, want %q", got.Locale, LocaleDE)
		}
		if got.Theme != ThemeSystem {
			t.Errorf("Theme = %q, want %q", got.Theme, ThemeSystem)
		}
	})

	t.Run("upsert updates profile but keeps id and settings", func(t *testing.T) {
		first, err := repo.UpsertByGoogleSub(ctx, testIdentity("update"))
		if err != nil {
			t.Fatalf("first UpsertByGoogleSub() error = %v", err)
		}
		// Raw SQL because the app has no query to change settings yet.
		if _, err := pool.Exec(ctx, `UPDATE users SET locale = 'en', theme = 'dark' WHERE id = $1`, first.ID); err != nil {
			t.Fatalf("change settings: %v", err)
		}

		changed := Identity{
			Subject:   testIdentity("update").Subject,
			Email:     "renamed@example.com",
			Name:      "Renamed",
			AvatarURL: "https://example.com/new.png",
			nameGiven: true,
		}
		second, err := repo.UpsertByGoogleSub(ctx, changed)
		if err != nil {
			t.Fatalf("second UpsertByGoogleSub() error = %v", err)
		}

		if second.ID != first.ID {
			t.Errorf("ID = %v, want %v", second.ID, first.ID)
		}
		assertProfile(t, second, changed)
		if second.Locale != LocaleEN {
			t.Errorf("Locale = %q, want %q", second.Locale, LocaleEN)
		}
		if second.Theme != ThemeDark {
			t.Errorf("Theme = %q, want %q", second.Theme, ThemeDark)
		}
	})

	t.Run("upsert without a given name keeps the stored name", func(t *testing.T) {
		first, err := repo.UpsertByGoogleSub(ctx, testIdentity("keep-name"))
		if err != nil {
			t.Fatalf("first UpsertByGoogleSub() error = %v", err)
		}

		// The service sets nameGiven only for a real name, so the fallback
		// below must not overwrite the stored one.
		fallback := testIdentity("keep-name")
		fallback.Name = "keep-name-fallback"
		fallback.nameGiven = false
		second, err := repo.UpsertByGoogleSub(ctx, fallback)
		if err != nil {
			t.Fatalf("second UpsertByGoogleSub() error = %v", err)
		}

		if second.ID != first.ID {
			t.Errorf("ID = %v, want %v", second.ID, first.ID)
		}
		if second.DisplayName != first.DisplayName {
			t.Errorf("DisplayName = %q, want %q", second.DisplayName, first.DisplayName)
		}
	})

	t.Run("upsert without a given name names a new user after the fallback", func(t *testing.T) {
		identity := testIdentity("new-fallback")
		identity.Name = "new-fallback-local"
		identity.nameGiven = false

		got, err := repo.UpsertByGoogleSub(ctx, identity)
		if err != nil {
			t.Fatalf("UpsertByGoogleSub() error = %v", err)
		}
		if got.DisplayName != identity.Name {
			t.Errorf("DisplayName = %q, want %q", got.DisplayName, identity.Name)
		}
	})

	t.Run("empty avatar is stored as null", func(t *testing.T) {
		identity := testIdentity("no-avatar")
		identity.AvatarURL = ""

		created, err := repo.UpsertByGoogleSub(ctx, identity)
		if err != nil {
			t.Fatalf("UpsertByGoogleSub() error = %v", err)
		}

		var isNull bool
		err = pool.QueryRow(ctx, `SELECT avatar_url IS NULL FROM users WHERE id = $1`, created.ID).Scan(&isNull)
		if err != nil {
			t.Fatalf("read avatar_url: %v", err)
		}
		if !isNull {
			t.Error("avatar_url is not NULL")
		}

		got, err := repo.Get(ctx, created.ID)
		if err != nil {
			t.Fatalf("Get() error = %v", err)
		}
		if got.AvatarURL != "" {
			t.Errorf("AvatarURL = %q, want empty", got.AvatarURL)
		}
	})

	t.Run("get returns stored user", func(t *testing.T) {
		created, err := repo.UpsertByGoogleSub(ctx, testIdentity("get"))
		if err != nil {
			t.Fatalf("UpsertByGoogleSub() error = %v", err)
		}

		got, err := repo.Get(ctx, created.ID)
		if err != nil {
			t.Fatalf("Get() error = %v", err)
		}
		if got.ID != created.ID || !got.CreatedAt.Equal(created.CreatedAt) {
			t.Errorf("Get() = %+v, want %+v", got, created)
		}
		assertProfile(t, got, testIdentity("get"))
	})

	t.Run("get unknown id", func(t *testing.T) {
		if _, err := repo.Get(ctx, uuid.New()); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get() error = %v, want %v", err, ErrNotFound)
		}
	})
}

// testIdentity returns an identity whose subject and email are derived from
// name, because google_sub is unique.
func testIdentity(name string) Identity {
	return Identity{
		Subject:   "test-" + name,
		Email:     name + "@example.com",
		Name:      name,
		AvatarURL: "https://example.com/" + name + ".png",
		nameGiven: true,
	}
}

func assertProfile(t *testing.T, got User, want Identity) {
	t.Helper()
	if got.Email != want.Email {
		t.Errorf("Email = %q, want %q", got.Email, want.Email)
	}
	if got.DisplayName != want.Name {
		t.Errorf("DisplayName = %q, want %q", got.DisplayName, want.Name)
	}
	if got.AvatarURL != want.AvatarURL {
		t.Errorf("AvatarURL = %q, want %q", got.AvatarURL, want.AvatarURL)
	}
}
