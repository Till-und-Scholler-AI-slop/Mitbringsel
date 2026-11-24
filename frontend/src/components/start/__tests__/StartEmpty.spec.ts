import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import StartEmpty from '../StartEmpty.vue'

function mountEmpty() {
  return mount(StartEmpty, { global: { plugins: [createAppI18n(['en'], null)] } })
}

describe('StartEmpty', () => {
  it('says that there is no household yet and that joining needs a link', () => {
    const wrapper = mountEmpty()

    expect(wrapper.get('h3').text()).toBe('No household yet')
    expect(wrapper.get('.no-link').text()).toContain("You can't join without a link.")
  })

  it('asks the parent to found a household', async () => {
    const wrapper = mountEmpty()

    const create = wrapper.get('.option--create')
    expect(create.text()).toContain('Create household')
    expect(create.attributes('aria-haspopup')).toBe('dialog')
    await create.trigger('click')

    expect(wrapper.emitted('create')).toHaveLength(1)
  })

  it('asks the parent to join a household', async () => {
    const wrapper = mountEmpty()

    const join = wrapper.get('.option--join')
    expect(join.text()).toContain('Paste invite link')
    await join.trigger('click')

    expect(wrapper.emitted('join')).toHaveLength(1)
  })

  it('keeps the decoration away from screen readers', () => {
    expect(mountEmpty().get('.badges').attributes('aria-hidden')).toBe('true')
  })

  it('disables both options while offline', async () => {
    const wrapper = mount(StartEmpty, {
      props: { offline: true },
      global: { plugins: [createAppI18n(['en'], null)] },
    })

    const create = wrapper.get('.option--create')
    const join = wrapper.get('.option--join')
    expect(create.attributes('disabled')).toBeDefined()
    expect(join.attributes('disabled')).toBeDefined()

    await create.trigger('click')
    await join.trigger('click')
    expect(wrapper.emitted('create')).toBeUndefined()
    expect(wrapper.emitted('join')).toBeUndefined()
  })
})
