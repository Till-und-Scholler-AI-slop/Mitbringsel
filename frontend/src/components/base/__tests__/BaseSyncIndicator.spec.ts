import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { ICONS } from '@/components/base/icons'
import { createAppI18n } from '@/i18n'

import BaseSyncIndicator from '../BaseSyncIndicator.vue'

function mountIndicator(
  props: InstanceType<typeof BaseSyncIndicator>['$props'],
  locale: 'de' | 'en' = 'en',
) {
  return mount(BaseSyncIndicator, {
    props,
    global: { plugins: [createAppI18n([locale], null)] },
  })
}

const iconPaths = (wrapper: ReturnType<typeof mountIndicator>) =>
  wrapper.findAll('.chip svg path').map((p) => p.attributes('d'))

describe('BaseSyncIndicator', () => {
  it('says synced in a status region, short on the phone and long in the sidebar', () => {
    const md = mountIndicator({ state: 'synced' })
    const lg = mountIndicator({ state: 'synced', size: 'lg' })

    expect(md.get('[role="status"]').text()).toBe('Synced')
    expect(md.get('[role="status"]').attributes('aria-label')).toBe('Sync status: All synced')
    expect(md.find('.chip--synced').exists()).toBe(true)
    expect(iconPaths(md)).toEqual([...ICONS.cloudCheck])
    expect(lg.get('.chip').text()).toBe('All synced')
  })

  it('says offline in the dark chip when nothing is pending', () => {
    const wrapper = mountIndicator({ state: 'offline', size: 'lg' })

    expect(wrapper.get('.chip').text()).toBe('Offline')
    expect(wrapper.get('[role="status"]').attributes('aria-label')).toBe('Sync status: Offline')
    expect(wrapper.find('.chip--offline').exists()).toBe(true)
    expect(iconPaths(wrapper)).toEqual([...ICONS.cloudOff])
  })

  it('shows the yellow chip with upload cloud when online with pending changes', () => {
    const wrapper = mountIndicator({ state: 'synced', pendingCount: 2 })

    expect(wrapper.get('.chip').text()).toBe('2 pending')
    expect(wrapper.find('.chip--pending').exists()).toBe(true)
    expect(iconPaths(wrapper)).toEqual([...ICONS.cloudUpload])
  })

  it('shows the yellow chip with crossed-out cloud when offline with pending changes', () => {
    const wrapper = mountIndicator({ state: 'offline', pendingCount: 3 })

    expect(wrapper.get('.chip').text()).toBe('Offline · 3 pending')
    expect(wrapper.find('.chip--pending').exists()).toBe(true)
    expect(iconPaths(wrapper)).toEqual([...ICONS.cloudOff])
  })

  it.each([
    ['de', 'synced', 1, '1 ausstehend', 'Sync-Status: 1 Änderung ausstehend'],
    ['de', 'synced', 3, '3 ausstehend', 'Sync-Status: 3 Änderungen ausstehend'],
    ['de', 'offline', 1, 'Offline · 1 ausstehend', 'Sync-Status: Offline, 1 Änderung ausstehend'],
    ['de', 'offline', 3, 'Offline · 3 ausstehend', 'Sync-Status: Offline, 3 Änderungen ausstehend'],
    ['en', 'synced', 1, '1 pending', 'Sync status: 1 pending change'],
    ['en', 'synced', 3, '3 pending', 'Sync status: 3 pending changes'],
    ['en', 'offline', 1, 'Offline · 1 pending', 'Sync status: Offline, 1 pending change'],
    ['en', 'offline', 3, 'Offline · 3 pending', 'Sync status: Offline, 3 pending changes'],
  ] as const)(
    '%s (%s, %i): uses pluralized aria-label and short visible text',
    (locale, state, pendingCount, visible, aria) => {
      const wrapper = mountIndicator({ state, pendingCount }, locale)

      expect(wrapper.get('.chip').text()).toBe(visible)
      expect(wrapper.get('[role="status"]').attributes('aria-label')).toBe(aria)
    },
  )

  it('explains every state only with hint, naming the household when open', () => {
    expect(mountIndicator({ state: 'synced' }).find('.hint').exists()).toBe(false)
    expect(mountIndicator({ state: 'synced', hint: true }).get('.hint').text()).toBe(
      'Everyone sees the same state.',
    )
    expect(mountIndicator({ state: 'offline', hint: true }).get('.hint').text()).toBe(
      'Changes stay on this device and go out as soon as you’re back online.',
    )
    expect(
      mountIndicator({ state: 'offline', pendingCount: 2, hint: true }).get('.hint').text(),
    ).toBe('Changes stay on this device and go out as soon as you’re back online.')
    expect(
      mountIndicator({ state: 'synced', pendingCount: 1, hint: true }).get('.hint').text(),
    ).toBe('Sending changes …')
    expect(
      mountIndicator({
        state: 'synced',
        pendingCount: 1,
        hint: true,
        householdName: 'WG Kaiserstraße',
      })
        .get('.hint')
        .text(),
    ).toBe('Sending to WG Kaiserstraße …')
    expect(
      mountIndicator(
        { state: 'synced', pendingCount: 1, hint: true, householdName: 'WG Kaiserstraße' },
        'de',
      )
        .get('.hint')
        .text(),
    ).toBe('Wird gerade an WG Kaiserstraße übertragen …')
    expect(
      mountIndicator({ state: 'synced', pendingCount: 1, hint: true }, 'de').get('.hint').text(),
    ).toBe('Wird gerade übertragen …')
  })
})
