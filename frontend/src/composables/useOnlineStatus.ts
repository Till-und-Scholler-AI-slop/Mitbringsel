import { onScopeDispose, readonly, ref } from 'vue'

/**
 * Whether the browser has a network connection, updated live.
 *
 * navigator.onLine only knows "no network at all"; a network without
 * internet still counts as online. That is enough to say "you are offline"
 * early, real failures still come back as NETWORK errors from the API.
 */
export function useOnlineStatus() {
  const online = ref(navigator.onLine !== false)

  const update = () => {
    online.value = navigator.onLine !== false
  }
  window.addEventListener('online', update)
  window.addEventListener('offline', update)

  // Runs when the component (or effect scope) using this goes away.
  onScopeDispose(() => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })

  return { online: readonly(online) }
}
