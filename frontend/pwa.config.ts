import type { VitePWAOptions } from 'vite-plugin-pwa'

// Paths handled by the Go backend (REST, OAuth callbacks, WebSocket).
// Navigation requests to /api must reach the server and never fall back
// to the cached index.html app shell.
export const API_NAVIGATE_DENYLIST = /^\/api(?:\/|\?|$)/

export const pwaOptions: Partial<VitePWAOptions> = {
  strategies: 'generateSW',
  registerType: 'autoUpdate',
  injectRegister: 'auto',
  devOptions: {
    // Keep the service worker off in `npm run dev` so the Vite /api proxy
    // and WebSocket upgrades stay untouched.
    enabled: false,
  },
  includeAssets: ['favicon.ico', 'icon.svg', 'apple-touch-icon.png'],
  manifest: {
    id: '/',
    name: 'Tuolino',
    short_name: 'Tuolino',
    description: 'Geteilte Einkaufslisten – live synchron, auch offline.',
    lang: 'de',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#1F7A3A',
    background_color: '#E4F2FC',
    icons: [
      {
        src: '/pwa-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-512x512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  },
  workbox: {
    // Precache only the built app shell (icons come from includeAssets and the
    // manifest so they are not listed twice), never /api.
    globPatterns: ['**/*.{js,css,html,woff2}'],
    cleanupOutdatedCaches: true,
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [API_NAVIGATE_DENYLIST],
    // No runtime caching: API data lives in IndexedDB via the stores and outbox.
    runtimeCaching: [],
  },
}
