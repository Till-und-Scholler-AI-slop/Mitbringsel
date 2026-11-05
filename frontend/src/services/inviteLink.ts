/** How many invite links a group can have open at once (the backend answers TOO_MANY_INVITES beyond). */
export const MAX_OPEN_INVITES = 10

/** The path in front of the token in an invite link: `<origin>/invite/<token>`. */
export const INVITE_PATH = '/invite/'

// Tokens are base64url (docs/auth.md). The server decides whether a token is
// real; this only tells "looks like an invite link" from any other text. The
// minimum keeps out short words like /invite/abc.
const INVITE_LINK_PATTERN = /\/invite\/([A-Za-z0-9_-]{20,})(?:[/?#]|$)/

/**
 * Reads the token out of a pasted invite link, or null if the text does not
 * look like one. The host is not checked: the token only ever goes to this
 * app's own API.
 */
export function extractInviteToken(input: string): string | null {
  return INVITE_LINK_PATTERN.exec(input.trim())?.[1] ?? null
}

/**
 * The link to hand out for a token: `<origin>/invite/<token>`. The origin is
 * the one the app runs on, so the link opens the same app.
 */
export function buildInviteLink(origin: string, token: string): string {
  return `${origin}${INVITE_PATH}${encodeURIComponent(token)}`
}
