import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import GoogleSignInButton from '../GoogleSignInButton.vue'

function mountButton(props: { disabled?: boolean; busy?: boolean } = {}) {
  return mount(GoogleSignInButton, {
    props,
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

describe('GoogleSignInButton', () => {
  it('shows the translated label and passes clicks on', async () => {
    const wrapper = mountButton()

    await wrapper.get('button').trigger('click')

    expect(wrapper.get('button').text()).toBe('Sign in with Google')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('is disabled and busy while redirecting', () => {
    const button = mountButton({ busy: true }).get('button')

    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBe('true')
  })

  it('can be disabled without being busy', () => {
    const button = mountButton({ disabled: true }).get('button')

    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('aria-busy')).toBeUndefined()
  })
})
