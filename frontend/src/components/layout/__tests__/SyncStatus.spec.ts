import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import type { SyncIndicator } from '@/stores/sync'

import SyncStatus from '../SyncStatus.vue'

const sync = vi.hoisted(() => ({ indicator: 'hidden' as SyncIndicator }))
vi.mock('@/stores/sync', () => ({ useSyncStore: () => sync }))

function mountStatus() {
  return mount(SyncStatus, {
    props: { size: 'lg', hint: true },
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

describe('SyncStatus', () => {
  it('shows nothing while nobody is signed in', () => {
    sync.indicator = 'hidden'

    expect(mountStatus().find('[role="status"]').exists()).toBe(false)
  })

  it('shows the state of the store and passes size and hint on', () => {
    sync.indicator = 'offline'

    const wrapper = mountStatus()

    expect(wrapper.get('.chip').text()).toBe('Offline')
    expect(wrapper.find('.hint').exists()).toBe(true)
  })
})
