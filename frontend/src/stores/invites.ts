import { ref } from 'vue'
import { defineStore } from 'pinia'

import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { invitesService, type InvitesService } from '@/services/api/invites'
import type { InviteAccepted, InvitePreview } from '@/types/api'

/** idle: nothing loaded. error: `errorCode` says why (e.g. INVITE_EXPIRED). */
export type InviteStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Builds the store around a service. Setup stores cannot take parameters,
 * so this factory is how tests inject a fake.
 *
 * It holds the invite the user is looking at, one at a time. The join dialog
 * loads it to check the link, then opens the invite page, which finds it
 * here and does not ask the server a second time.
 */
export function defineInvitesStore(service: InvitesService) {
  return defineStore('invites', () => {
    const token = ref<string | null>(null)
    const preview = ref<InvitePreview | null>(null)
    const status = ref<InviteStatus>('idle')
    const errorCode = ref<string | null>(null)
    // Set when the server says "too many requests": seconds until the next try.
    const retryAfterSeconds = ref<number | null>(null)

    // A newer load or a clear() makes a load that is still running outdated.
    let generation = 0

    function clear() {
      generation++
      token.value = null
      preview.value = null
      status.value = 'idle'
      errorCode.value = null
      retryAfterSeconds.value = null
    }

    /** True if the invite for this token is loaded already. */
    function has(forToken: string): boolean {
      return token.value === forToken && status.value === 'ready'
    }

    /** Loads the invite. Never throws; `status` and `errorCode` tell the result. */
    async function load(forToken: string) {
      clear()
      const started = generation
      token.value = forToken
      status.value = 'loading'
      try {
        const loaded = await service.preview(forToken)
        if (started !== generation) return
        preview.value = loaded
        status.value = 'ready'
      } catch (err) {
        if (started !== generation) return
        status.value = 'error'
        errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
        retryAfterSeconds.value = err instanceof ApiError ? (err.retryAfterSeconds ?? null) : null
      }
    }

    /** Joins the group. Rejects with the ApiError so the page can show it. */
    function accept(forToken: string): Promise<InviteAccepted> {
      return service.accept(forToken)
    }

    return { token, preview, status, errorCode, retryAfterSeconds, has, load, clear, accept }
  })
}

export const useInvitesStore = defineInvitesStore(invitesService)
