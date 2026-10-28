import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Where the Go server listens during development. Override with the
// VITE_API_PROXY_TARGET environment variable, e.g. if port 8080 is taken.
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // The browser only talks to Vite; /api is forwarded to the Go server,
    // so the frontend uses the same relative URLs in development and production.
    proxy: {
      '/api': { target: apiProxyTarget, changeOrigin: true },
    },
  },
})
