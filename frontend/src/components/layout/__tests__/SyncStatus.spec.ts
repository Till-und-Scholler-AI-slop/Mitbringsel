import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { SyncIndicator } from '@/stores/sync'

import SyncStatus from '../SyncStatus.vue'

const sync = vi.hoisted(() => ({ indicator: 'hidden' as SyncIndicator }))
const items = vi.hoisted(() => ({ pendingCount: 0 }))
vi.mock('@/stores/sync', () => ({ useSyncStore: () => sync }))
vi.mock('@/stores/items', () => ({ useItemsStore: () => items }))

function mountStatus(extra: { householdName?: string } = {}) {
  return mount(SyncStatus, {
    props: { size: 'lg', hint: true, ...extra },
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

describe('SyncStatus', () => {
  it('shows nothing while nobody is signed in', () => {
    sync.indicator = 'hidden'
    items.pendingCount = 0

    expect(mountStatus().find('[role="status"]').exists()).toBe(false)
  })

  it('shows the state of the store and passes size and hint on', () => {
    sync.indicator = 'offline'
    items.pendingCount = 0

    const wrapper = mountStatus()

    expect(wrapper.get('.chip').text()).toBe('Offline')
    expect(wrapper.find('.hint').exists()).toBe(true)
  })

  it('forwards pendingCount and householdName to the indicator', () => {
    sync.indicator = 'synced'
    items.pendingCount = 2

    const wrapper = mountStatus({ householdName: 'WG Kaiserstraße' })

    expect(wrapper.get('.chip').text()).toBe('2 pending')
    expect(wrapper.get('.hint').text()).toBe('Sending to WG Kaiserstraße …')
  })

  it('combines offline state with pending changes', () => {
    sync.indicator = 'offline'
    items.pendingCount = 3

    const wrapper = mountStatus()

    expect(wrapper.get('.chip').text()).toBe('Offline · 3 pending')
    expect(wrapper.find('.chip--pending').exists()).toBe(true)
  })
})
