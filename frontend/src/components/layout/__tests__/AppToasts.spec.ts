import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

import { createAppI18n } from '@/i18n'
import { TOAST_DURATION_MS, type ToastEnd, useToastsStore } from '@/stores/toasts'

import AppToasts from '../AppToasts.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function mountToasts() {
  return mount(AppToasts, {
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
}

// jsdom has no PointerEvent; a MouseEvent with pointerType is what the
// handler reads.
function pointer(type: 'pointerenter' | 'pointerleave', pointerType: string) {
  const event = new MouseEvent(type)
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}

describe('AppToasts', () => {
  it('shows the toasts of the store in a live region, newest last', async () => {
    const store = useToastsStore()
    const wrapper = mountToasts()

    store.show({ kind: 'info', text: 'First' })
    store.show({ kind: 'success', text: 'Second' })
    await nextTick()

    expect(wrapper.get('.toasts').attributes('aria-live')).toBe('polite')
    expect(wrapper.findAll('.text').map((text) => text.text())).toEqual(['First', 'Second'])
  })

  it('passes action and close on to the store', async () => {
    const store = useToastsStore()
    const ends: ToastEnd[] = []
    const wrapper = mountToasts()
    store.show({ kind: 'success', text: 'A', actionLabel: 'Undo', onEnd: (r) => ends.push(r) })
    store.show({ kind: 'info', text: 'B', onEnd: (r) => ends.push(r) })
    await nextTick()

    await wrapper.get('.action').trigger('click')
    await wrapper.get('button[aria-label="Close message"]').trigger('click')

    expect(ends).toEqual(['action', 'closed'])
    expect(store.toasts).toHaveLength(0)
  })

  it('pauses while a mouse is over the stack, not for a finger', async () => {
    const store = useToastsStore()
    const wrapper = mountToasts()
    store.show({ kind: 'info', text: 'A' })
    await nextTick()
    const stack = wrapper.get('.toasts').element

    stack.dispatchEvent(pointer('pointerenter', 'touch'))
    await nextTick()
    expect(store.paused).toBe(false)

    stack.dispatchEvent(pointer('pointerenter', 'mouse'))
    await nextTick()
    expect(store.paused).toBe(true)
    vi.advanceTimersByTime(TOAST_DURATION_MS)
    expect(store.toasts).toHaveLength(1)

    stack.dispatchEvent(pointer('pointerleave', 'mouse'))
    await nextTick()
    expect(store.paused).toBe(false)
  })

  it('pauses while the focus is in the stack', async () => {
    const store = useToastsStore()
    const wrapper = mountToasts()
    store.show({ kind: 'success', text: 'A', actionLabel: 'Undo' })
    await nextTick()
    const action = wrapper.get('.action').element as HTMLButtonElement
    const close = wrapper.get('button[aria-label="Close message"]').element as HTMLButtonElement

    action.focus()
    await nextTick()
    expect(store.paused).toBe(true)

    // Moving within the stack keeps it paused, leaving it does not.
    close.focus()
    await nextTick()
    expect(store.paused).toBe(true)
    close.blur()
    await nextTick()
    expect(store.paused).toBe(false)
  })

  it('does not start the next toast paused after the last one went away', async () => {
    const store = useToastsStore()
    const wrapper = mountToasts()
    const first = store.show({ kind: 'info', text: 'A' })
    await nextTick()
    wrapper.get('.toasts').element.dispatchEvent(pointer('pointerenter', 'mouse'))
    await nextTick()

    store.close(first)
    await nextTick()
    store.show({ kind: 'info', text: 'B' })

    expect(store.paused).toBe(false)
  })
})
