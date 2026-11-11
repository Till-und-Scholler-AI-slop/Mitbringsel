import './styles/tokens.css'
import './styles/base.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { createAppI18n } from './i18n'
import router from './router'
import { installSessionExpiry } from './router/sessionExpiry'
import { useAuthStore } from './stores/auth'
import { useSyncStore } from './stores/sync'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(createAppI18n())

// After app.use(createPinia()): stores can only be created once Pinia is active.
installSessionExpiry(router, useAuthStore())

// The sync store opens and closes the live connection by itself as the user
// signs in and out; creating it here is all it needs.
useSyncStore()

app.mount('#app')
