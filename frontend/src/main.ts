import './styles/tokens.css'
import './styles/base.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { createAppI18n } from './i18n'
import router from './router'
import { installSessionExpiry } from './router/sessionExpiry'
import { useAuthStore } from './stores/auth'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(createAppI18n())

// After app.use(createPinia()): stores can only be created once Pinia is active.
installSessionExpiry(router, useAuthStore())

app.mount('#app')
