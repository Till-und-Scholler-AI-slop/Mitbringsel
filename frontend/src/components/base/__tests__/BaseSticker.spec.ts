import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BaseSticker from '../BaseSticker.vue'
import { STICKERS } from '../stickers'

describe('BaseSticker', () => {
  it('is decoration for screen readers', () => {
    const wrapper = mount(BaseSticker, { props: { icon: 'bakery' } })

    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.attributes('focusable')).toBe('false')
  })

  it('is 46 px unless told otherwise', () => {
    expect(mount(BaseSticker, { props: { icon: 'bakery' } }).attributes('width')).toBe('46')
    expect(mount(BaseSticker, { props: { icon: 'bakery', size: 96 } }).attributes('height')).toBe(
      '96',
    )
  })

  it('draws every shape as shadow, white border and art, askew', () => {
    const wrapper = mount(BaseSticker, { props: { icon: 'bakery' } })
    const { rotate, shapes } = STICKERS.bakery

    expect(wrapper.get('g').attributes('transform')).toBe(`rotate(${rotate} 24 24)`)
    for (const layer of ['.sticker-shadow', '.sticker-border', '.sticker-art']) {
      expect(wrapper.get(layer).findAll('path')).toHaveLength(shapes.length)
    }
    // The border is wider than the outline, so it shows around it.
    const art = wrapper.get('.sticker-art path')
    const border = wrapper.get('.sticker-border path')
    expect(Number(border.attributes('stroke-width'))).toBeGreaterThan(
      Number(art.attributes('stroke-width')),
    )
    expect(border.attributes('stroke')).toBe('#ffffff')
    expect(wrapper.get('.sticker-shadow').attributes('transform')).toBe('translate(0 2.5)')
  })

  it('keeps lines open in every layer', () => {
    const wrapper = mount(BaseSticker, { props: { icon: 'bakery' } })
    // The first line of the bakery: the score on the baguette.
    const line = STICKERS.bakery.shapes.findIndex((s) => s.fill === null)

    for (const layer of ['.sticker-shadow', '.sticker-border', '.sticker-art']) {
      expect(wrapper.get(layer).findAll('path')[line]!.attributes('fill')).toBe('none')
    }
  })

  it.each(Object.entries(STICKERS))('%s has shapes and sits only a little askew', (_, sticker) => {
    expect(sticker.shapes.length).toBeGreaterThan(0)
    expect(Math.abs(sticker.rotate)).toBeLessThanOrEqual(6)
  })
})
