import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import BrandLogo from '../BrandLogo.vue'

const global = { plugins: [createAppI18n(['en'], null)] }

describe('BrandLogo', () => {
  it('shows the app name in the normal size by default', () => {
    const wrapper = mount(BrandLogo, { global })

    expect(wrapper.text()).toBe('Mitbringsel')
    expect(wrapper.classes()).toEqual(['logo'])
  })

  it.each(['small', 'large', 'flat'] as const)('has a %s variant', (variant) => {
    const wrapper = mount(BrandLogo, { props: { [variant]: true }, global })

    expect(wrapper.classes()).toContain(`logo--${variant}`)
  })
})
