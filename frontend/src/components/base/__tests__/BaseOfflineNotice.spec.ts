import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { ICONS } from '@/components/base/icons'
import { createAppI18n } from '@/i18n'

import BaseOfflineNotice from '../BaseOfflineNotice.vue'

function mountNotice(props: InstanceType<typeof BaseOfflineNotice>['$props']) {
  return mount(BaseOfflineNotice, {
    props,
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

describe('BaseOfflineNotice', () => {
  it('shows a card with the Offline badge, cloudOff icon and text by default', () => {
    const wrapper = mountNotice({ text: 'You can still edit items.' })

    const root = wrapper.get('[role="status"]')
    expect(root.classes()).toContain('offline-notice--card')
    expect(wrapper.get('.badge').text()).toBe('Offline')
    expect(wrapper.findAll('.badge svg path').map((p) => p.attributes('d'))).toEqual([
      ...ICONS.cloudOff,
    ])
    expect(root.text()).toContain('You can still edit items.')
  })

  it('shows a compact inline hint without the badge', () => {
    const wrapper = mountNotice({ text: 'Requires a connection.', variant: 'inline' })

    const root = wrapper.get('[role="status"]')
    expect(root.classes()).toContain('offline-notice--inline')
    expect(wrapper.find('.badge').exists()).toBe(false)
    expect(wrapper.findAll('svg path').map((p) => p.attributes('d'))).toEqual([...ICONS.cloudOff])
    expect(root.text()).toBe('Requires a connection.')
  })

  it('switches to brand ink when placed on the green sidebar', () => {
    const wrapper = mountNotice({
      text: 'Creating a household requires a connection.',
      variant: 'inline',
      onBrand: true,
    })

    expect(wrapper.get('[role="status"]').classes()).toContain('offline-notice--on-brand')
  })
})
