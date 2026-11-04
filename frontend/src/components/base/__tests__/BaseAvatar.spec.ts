import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BaseAvatar from '../BaseAvatar.vue'

describe('BaseAvatar', () => {
  it('shows the picture when there is one', () => {
    const wrapper = mount(BaseAvatar, { props: { name: 'Lena', src: 'https://example.com/a.png' } })

    const img = wrapper.get('img')
    expect(img.attributes('src')).toBe('https://example.com/a.png')
    expect(img.attributes('alt')).toBe('')
    expect(img.attributes('referrerpolicy')).toBe('no-referrer')
  })

  it('shows the capitalized initial without a picture', () => {
    const wrapper = mount(BaseAvatar, { props: { name: ' lena ', src: null } })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('L')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
  })

  it('keeps a character outside the basic plane whole', () => {
    const wrapper = mount(BaseAvatar, { props: { name: '😀 Smile' } })

    expect(wrapper.text()).toBe('😀')
  })

  it('shows a question mark for an empty name', () => {
    const wrapper = mount(BaseAvatar, { props: { name: '  ' } })

    expect(wrapper.text()).toBe('?')
  })

  it('gives the same name the same color', () => {
    const first = mount(BaseAvatar, { props: { name: 'Mehmet' } })
    const second = mount(BaseAvatar, { props: { name: 'Mehmet' } })

    expect(first.attributes('style')).toBe(second.attributes('style'))
    expect(first.attributes('style')).toContain('background')
  })

  it('falls back to the initial when the picture cannot be loaded', async () => {
    const wrapper = mount(BaseAvatar, { props: { name: 'Lena', src: 'https://example.com/x.png' } })

    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe('L')
  })

  it('tries a new picture after a failed one', async () => {
    const wrapper = mount(BaseAvatar, { props: { name: 'Lena', src: 'https://example.com/x.png' } })
    await wrapper.get('img').trigger('error')

    await wrapper.setProps({ src: 'https://example.com/y.png' })

    expect(wrapper.get('img').attributes('src')).toBe('https://example.com/y.png')
  })
})
