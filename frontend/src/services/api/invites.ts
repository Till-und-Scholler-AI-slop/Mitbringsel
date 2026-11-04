import type { InviteAccepted, InvitePreview } from '@/types/api'

import { apiGet, apiPostJson } from './client'

/** What the invites store needs from the backend; tests replace it with a fake. */
export interface InvitesService {
  /** Needs no login. Rejects with INVITE_NOT_FOUND or INVITE_EXPIRED. */
  preview(token: string): Promise<InvitePreview>
  /** The logged-in user becomes a member (or stays one, with the same role). */
  accept(token: string): Promise<InviteAccepted>
}

// The token goes into the path, so it must not be able to change the path.
const invitePath = (token: string) => `/invites/${encodeURIComponent(token)}`

export const invitesService: InvitesService = {
  preview: (token) => apiGet<InvitePreview>(invitePath(token)),
  accept: (token) => apiPostJson<InviteAccepted>(`${invitePath(token)}/accept`),
}
