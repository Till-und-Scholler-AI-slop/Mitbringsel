import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n, LOCALE_STORAGE_KEY } from '@/i18n'

import LanguageSwitch from '../LanguageSwitch.vue'

function mountSwitch() {
  const i18n = createAppI18n(['de'], null)
  const wrapper = mount(LanguageSwitch, { global: { plugins: [i18n] } })
  return { wrapper, i18n }
}

afterEach(() => {
  localStorage.clear()
})

describe('LanguageSwitch', () => {
  it('marks the active language as pressed', () => {
    const { wrapper } = mountSwitch()

    const [de, en] = wrapper.findAll('button')
    expect(de?.attributes('aria-pressed')).toBe('true')
    expect(en?.attributes('aria-pressed')).toBe('false')
    expect(en?.attributes('aria-label')).toBe('English')
  })

  it('switches the language and remembers it', async () => {
    const { wrapper, i18n } = mountSwitch()

    await wrapper.get('button[lang="en"]').trigger('click')

    expect(i18n.global.locale.value).toBe('en')
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en')
    expect(wrapper.get('[role="group"]').attributes('aria-label')).toBe('Language')
  })
})
