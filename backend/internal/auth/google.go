package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"mitbringsel/internal/user"
)

// Google's OpenID Connect endpoints. Written out instead of read from the
// discovery document at startup, so the server also starts while Google is
// unreachable. They have been stable for years.
const (
	googleIssuer   = "https://accounts.google.com"
	googleAuthURL  = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenURL = "https://oauth2.googleapis.com/token"
	googleKeysURL  = "https://www.googleapis.com/oauth2/v3/certs"

	// Without a timeout, a hanging Google would block the callback request
	// until the browser gives up.
	googleHTTPTimeout = 10 * time.Second
)

// ErrEmailNotVerified means Google does not vouch for the email address.
// Such accounts are refused: the address is shown to other group members.
var ErrEmailNotVerified = errors.New("google email address is not verified")

// LoginAttempt holds the random values of one Google login. The server
// keeps them (in a short-lived cookie) between sending the browser to
// Google and its return, and checks them on the way back:
//   - State ties Google's answer to this browser (CSRF protection).
//   - Nonce ties the ID token to this attempt (replay protection).
//   - Verifier proves that whoever exchanges the code also started the
//     login (PKCE), so an intercepted code is useless on its own.
type LoginAttempt struct {
	State    string
	Nonce    string
	Verifier string
}

// NewLoginAttempt returns fresh random values for one login.
func NewLoginAttempt() LoginAttempt {
	return LoginAttempt{
		// rand.Text returns 128 random bits, base32-encoded.
		State:    rand.Text(),
		Nonce:    rand.Text(),
		Verifier: oauth2.GenerateVerifier(),
	}
}

// GoogleProvider runs the server side of "Sign in with Google": it builds
// the URL that sends the browser to Google and turns Google's answer into
// a verified user.Identity. Google tokens never leave it.
type GoogleProvider struct {
	oauth    oauth2.Config
	verifier *oidc.IDTokenVerifier
	client   *http.Client
}

// NewGoogleProvider returns a provider for the OAuth client from the
// Google Cloud Console. redirectURL must be registered there exactly.
func NewGoogleProvider(clientID, clientSecret, redirectURL string) *GoogleProvider {
	client := &http.Client{Timeout: googleHTTPTimeout}
	// The key set fetches Google's signing keys when it first needs them
	// and again when they rotate. It keeps the context for those fetches,
	// so it gets one that lives as long as the server, not a request's.
	keys := oidc.NewRemoteKeySet(oidc.ClientContext(context.Background(), client), googleKeysURL)
	return newGoogleProvider(oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURL,
		Endpoint:     oauth2.Endpoint{AuthURL: googleAuthURL, TokenURL: googleTokenURL},
	}, keys, client)
}

// newGoogleProvider takes the endpoints and keys as parameters, so tests
// can point it at a fake Google.
func newGoogleProvider(cfg oauth2.Config, keys oidc.KeySet, client *http.Client) *GoogleProvider {
	// openid: we want an ID token; email and profile: its claims include
	// the address, name and picture.
	cfg.Scopes = []string{oidc.ScopeOpenID, "email", "profile"}
	return &GoogleProvider{
		oauth: cfg,
		// Checks signature, issuer, expiry and that the token was issued
		// for our client ID (audience).
		verifier: oidc.NewVerifier(googleIssuer, keys, &oidc.Config{ClientID: cfg.ClientID}),
		client:   client,
	}
}

// AuthCodeURL returns the Google URL the browser is sent to.
func (g *GoogleProvider) AuthCodeURL(attempt LoginAttempt) string {
	return g.oauth.AuthCodeURL(attempt.State,
		oidc.Nonce(attempt.Nonce),
		// Only a hash of the verifier goes to Google now; the verifier
		// itself follows with the code exchange.
		oauth2.S256ChallengeOption(attempt.Verifier),
	)
}

// Exchange trades the code from Google's redirect for the user's identity.
// The caller must have checked the state already; Exchange checks the ID
// token, its nonce and that the email address is verified.
func (g *GoogleProvider) Exchange(ctx context.Context, code string, attempt LoginAttempt) (user.Identity, error) {
	// The oauth2 package reads its HTTP client from the context.
	ctx = context.WithValue(ctx, oauth2.HTTPClient, g.client)

	token, err := g.oauth.Exchange(ctx, code, oauth2.VerifierOption(attempt.Verifier))
	if err != nil {
		return user.Identity{}, fmt.Errorf("exchange code: %w", err)
	}

	// The ID token comes as an extra field next to the access token. The
	// ", ok" form of the type assertion reports a missing field instead of
	// panicking.
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		return user.Identity{}, errors.New("token response has no id_token")
	}

	idToken, err := g.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return user.Identity{}, fmt.Errorf("verify id token: %w", err)
	}
	if idToken.Nonce != attempt.Nonce {
		return user.Identity{}, errors.New("id token nonce does not match the login attempt")
	}

	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return user.Identity{}, fmt.Errorf("read id token claims: %w", err)
	}
	if !claims.EmailVerified {
		return user.Identity{}, ErrEmailNotVerified
	}

	return user.Identity{
		Subject:   idToken.Subject,
		Email:     claims.Email,
		Name:      claims.Name,
		AvatarURL: claims.Picture,
	}, nil
}
