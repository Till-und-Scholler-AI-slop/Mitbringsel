/**
 * Leaves the app for a URL outside the router, e.g. the backend's Google
 * login. A function of its own so tests can replace it: jsdom cannot navigate.
 */
export function redirectTo(url: string) {
  window.location.assign(url)
}
