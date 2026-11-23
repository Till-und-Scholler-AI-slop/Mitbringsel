import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import BrandLogo from '../BrandLogo.vue'

const global = { plugins: [createAppI18n(['en'], null)] }

describe('BrandLogo', () => {
  it('shows the name as an image with two price tags in the normal size', () => {
    const wrapper = mount(BrandLogo, { global })

    expect(wrapper.classes()).toEqual(['logo'])
    expect(wrapper.attributes('role')).toBe('img')
    expect(wrapper.attributes('aria-label')).toBe('Tuolino')
    expect(wrapper.findAll('.tag')).toHaveLength(2)
  })

  it('draws the dot of the "i" in every size', () => {
    const wrapper = mount(BrandLogo, { props: { small: true }, global })

    expect(wrapper.find('.tag--front .dot').exists()).toBe(true)
  })

  it.each(['small', 'large'] as const)('has a %s variant', (variant) => {
    const wrapper = mount(BrandLogo, { props: { [variant]: true }, global })

    expect(wrapper.classes()).toContain(`logo--${variant}`)
  })
})
