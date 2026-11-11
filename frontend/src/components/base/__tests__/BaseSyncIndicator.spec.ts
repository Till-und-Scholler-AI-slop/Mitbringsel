import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import BaseSyncIndicator from '../BaseSyncIndicator.vue'

function mountIndicator(props: InstanceType<typeof BaseSyncIndicator>['$props']) {
  return mount(BaseSyncIndicator, {
    props,
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

describe('BaseSyncIndicator', () => {
  it('says synced in a status region, short on the phone and long in the sidebar', () => {
    const md = mountIndicator({ state: 'synced' })
    const lg = mountIndicator({ state: 'synced', size: 'lg' })

    expect(md.get('[role="status"]').text()).toBe('Synced')
    expect(md.find('.chip--synced').exists()).toBe(true)
    expect(lg.get('.chip').text()).toBe('All synced')
  })

  it('says offline in the dark chip', () => {
    const wrapper = mountIndicator({ state: 'offline', size: 'lg' })

    expect(wrapper.get('.chip').text()).toBe('Offline')
    expect(wrapper.find('.chip--offline').exists()).toBe(true)
  })

  it('explains the state only with hint', () => {
    expect(mountIndicator({ state: 'synced' }).find('.hint').exists()).toBe(false)
    expect(mountIndicator({ state: 'synced', hint: true }).get('.hint').text()).toBe(
      'Everyone sees the same state.',
    )
    expect(mountIndicator({ state: 'offline', hint: true }).get('.hint').text()).toBe(
      'You see the last known state. Changes need a connection again.',
    )
  })
})
