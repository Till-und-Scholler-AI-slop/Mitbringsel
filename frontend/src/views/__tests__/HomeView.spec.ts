import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'

import { createAppI18n } from '@/i18n'

import HomeView from '../HomeView.vue'

// Only fetch is faked, so this runs the whole chain: view -> store -> service -> client.
function mountHome(fetchImpl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(fetchImpl))
  return mount(HomeView, {
    global: { plugins: [createPinia(), createAppI18n(['en'])] },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HomeView', () => {
  it('shows the loading text first, then that the server is connected', async () => {
    const wrapper = mountHome(() => Promise.resolve(Response.json({ status: 'ok' })))
    expect(wrapper.get('[role="status"]').text()).toContain('Checking connection')

    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toContain('Connected')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('shows the translated message for a backend error code', async () => {
    const wrapper = mountHome(() =>
      Promise.resolve(Response.json({ error: { code: 'DB_UNAVAILABLE' } }, { status: 503 })),
    )

    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toContain(
      'The database is currently unavailable.',
    )
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('shows the network message when the server cannot be reached', async () => {
    const wrapper = mountHome(() => Promise.reject(new TypeError('Failed to fetch')))

    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toContain('The server cannot be reached.')
  })

  it('falls back to the generic message for an unknown error code', async () => {
    const wrapper = mountHome(() =>
      Promise.resolve(Response.json({ error: { code: 'SOMETHING_NEW' } }, { status: 500 })),
    )

    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toContain('Something went wrong.')
  })

  it('checks again when the retry button is clicked', async () => {
    let healthy = false
    const wrapper = mountHome(() =>
      healthy
        ? Promise.resolve(Response.json({ status: 'ok' }))
        : Promise.reject(new TypeError('Failed to fetch')),
    )
    await flushPromises()

    healthy = true
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="status"]').text()).toContain('Connected')
  })
})
