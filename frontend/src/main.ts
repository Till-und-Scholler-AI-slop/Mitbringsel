import './styles/tokens.css'
import './styles/base.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import { createAppI18n } from './i18n'
import router from './router'
import { installSessionExpiry } from './router/sessionExpiry'
import { installPreload } from './services/sync/preload'
import { liveSocket } from './services/sync/socket'
import { useAuthStore } from './stores/auth'
import { useGroupsStore } from './stores/groups'
import { useItemsStore } from './stores/items'
import { useListsStore } from './stores/lists'
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

// After every `ready`, load households, lists and items again, those of
// every household, so they are on the device when the network goes away.
const auth = useAuthStore()
const groups = useGroupsStore()
const lists = useListsStore()
const items = useItemsStore()
installPreload(liveSocket, {
  userId: () => auth.user?.id ?? null,
  loadGroups: () => groups.load(),
  groupIds: () => groups.groups.map((group) => group.id),
  loadLists: (groupId) => lists.load(groupId),
  loadGroupItems: (groupId) => items.loadGroup(groupId),
  reloadItems: (skip) => items.reloadLoaded(skip),
})

app.mount('#app')
