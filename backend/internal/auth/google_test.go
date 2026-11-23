package auth

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"tuolino/internal/user"
)

const (
	testClientID    = "test-client.apps.googleusercontent.com"
	testRedirectURL = "https://app.example.com/api/v1/auth/google/callback"
	testCode        = "CODE-FROM-GOOGLE"
)

// fakeGoogle is a token endpoint that answers with an ID token signed by
// its own key. claims can be changed per test before the exchange.
type fakeGoogle struct {
	key          *rsa.PrivateKey
	claims       map[string]any
	gotVerifier  string
	gotCode      string
	tokenFailure bool
}

func newFakeGoogle(t *testing.T, attempt LoginAttempt) *fakeGoogle {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	return &fakeGoogle{
		key: key,
		claims: map[string]any{
			"iss":            googleIssuer,
			"aud":            testClientID,
			"sub":            "1234567890",
			"email":          "anna@example.com",
			"email_verified": true,
			"name":           "Anna",
			"picture":        "https://example.com/anna.png",
			"nonce":          attempt.Nonce,
			"iat":            time.Now().Unix(),
			"exp":            time.Now().Add(time.Hour).Unix(),
		},
	}
}

func (f *fakeGoogle) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	f.gotCode = r.PostForm.Get("code")
	f.gotVerifier = r.PostForm.Get("code_verifier")
	if f.tokenFailure {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"access_token": "ACCESS",
		"token_type":   "Bearer",
		"expires_in":   3600,
		"id_token":     f.signedIDToken(),
	})
}

// signedIDToken builds a JWT by hand: base64url(header).base64url(claims),
// signed with RS256 like Google's tokens.
func (f *fakeGoogle) signedIDToken() string {
	enc := base64.RawURLEncoding
	header, _ := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT"})
	payload, _ := json.Marshal(f.claims)
	signingInput := enc.EncodeToString(header) + "." + enc.EncodeToString(payload)
	digest := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, f.key, crypto.SHA256, digest[:])
	if err != nil {
		panic(err)
	}
	return signingInput + "." + enc.EncodeToString(sig)
}

// newTestProvider points a provider at the fake and trusts only its key.
func newTestProvider(t *testing.T, fake *fakeGoogle) *GoogleProvider {
	t.Helper()
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)
	keys := &oidc.StaticKeySet{PublicKeys: []crypto.PublicKey{&fake.key.PublicKey}}
	return newGoogleProvider(oauth2.Config{
		ClientID:     testClientID,
		ClientSecret: "secret",
		RedirectURL:  testRedirectURL,
		Endpoint:     oauth2.Endpoint{AuthURL: googleAuthURL, TokenURL: srv.URL},
	}, keys, srv.Client())
}

func TestNewLoginAttemptIsRandom(t *testing.T) {
	a, b := NewLoginAttempt(), NewLoginAttempt()
	if a.State == "" || a.Nonce == "" || a.Verifier == "" {
		t.Fatalf("empty value in %+v", a)
	}
	if a == b {
		t.Fatal("two login attempts are equal")
	}
}

func TestAuthCodeURL(t *testing.T) {
	attempt := NewLoginAttempt()
	p := newTestProvider(t, newFakeGoogle(t, attempt))

	u, err := url.Parse(p.AuthCodeURL(attempt))
	if err != nil {
		t.Fatalf("parse url: %v", err)
	}
	if got := u.Scheme + "://" + u.Host + u.Path; got != googleAuthURL {
		t.Errorf("url = %q, want %q", got, googleAuthURL)
	}

	q := u.Query()
	want := map[string]string{
		"client_id":             testClientID,
		"redirect_uri":          testRedirectURL,
		"response_type":         "code",
		"scope":                 "openid email profile",
		"state":                 attempt.State,
		"nonce":                 attempt.Nonce,
		"code_challenge":        oauth2.S256ChallengeFromVerifier(attempt.Verifier),
		"code_challenge_method": "S256",
	}
	for key, value := range want {
		if q.Get(key) != value {
			t.Errorf("%s = %q, want %q", key, q.Get(key), value)
		}
	}
	// The verifier itself must stay on the server until the exchange.
	if q.Has("code_verifier") {
		t.Error("url contains the code verifier")
	}
}

func TestExchange(t *testing.T) {
	tests := []struct {
		name         string
		changeClaims map[string]any
		tokenFailure bool
		wantErr      error // if set, the error must wrap it
		wantFail     bool
	}{
		{name: "valid token"},
		{name: "token endpoint refuses the code", tokenFailure: true, wantFail: true},
		{name: "nonce from another attempt", changeClaims: map[string]any{"nonce": "OTHER"}, wantFail: true},
		{name: "token for another client", changeClaims: map[string]any{"aud": "someone-else"}, wantFail: true},
		{name: "token from another issuer", changeClaims: map[string]any{"iss": "https://evil.example.com"}, wantFail: true},
		{name: "expired token", changeClaims: map[string]any{"exp": time.Now().Add(-time.Hour).Unix()}, wantFail: true},
		{
			name:         "unverified email",
			changeClaims: map[string]any{"email_verified": false},
			wantErr:      ErrEmailNotVerified,
			wantFail:     true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			attempt := NewLoginAttempt()
			fake := newFakeGoogle(t, attempt)
			for k, v := range tt.changeClaims {
				fake.claims[k] = v
			}
			fake.tokenFailure = tt.tokenFailure
			p := newTestProvider(t, fake)

			got, err := p.Exchange(t.Context(), testCode, attempt)

			if fake.gotCode != testCode || fake.gotVerifier != attempt.Verifier {
				t.Errorf("token request had code %q and verifier %q", fake.gotCode, fake.gotVerifier)
			}
			if tt.wantFail {
				if err == nil {
					t.Fatalf("Exchange() = %+v, want an error", got)
				}
				if tt.wantErr != nil && !errors.Is(err, tt.wantErr) {
					t.Errorf("Exchange() error = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Exchange() error = %v", err)
			}
			want := user.Identity{
				Subject:   "1234567890",
				Email:     "anna@example.com",
				Name:      "Anna",
				AvatarURL: "https://example.com/anna.png",
			}
			if got != want {
				t.Errorf("Exchange() = %+v, want %+v", got, want)
			}
		})
	}
}
