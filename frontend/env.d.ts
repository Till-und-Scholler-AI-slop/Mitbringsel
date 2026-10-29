/// <reference types="vite/client" />

// Variables from frontend/.env.local (see .env.example). Vite only exposes
// variables with the VITE_ prefix to the frontend.
interface ImportMetaEnv {
  readonly VITE_DEV_USER_EMAIL?: string
  readonly VITE_DEV_USER_NAME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
