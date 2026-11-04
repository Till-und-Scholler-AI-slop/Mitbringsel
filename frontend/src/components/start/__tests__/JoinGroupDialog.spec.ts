import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { InvitesService } from '@/services/api/invites'
import type { InvitePreview } from '@/types/api'

import JoinGroupDialog from '../JoinGroupDialog.vue'

const TOKEN = 'Kx9f2mQ7vLp3Zt8RnW4cYb6HdJs1Ua5EoN0gXiT7wBq'
const LINK = `https://mitbringsel.tinowolter.com/invite/${TOKEN}`

const PREVIEW: InvitePreview = {
  groupName: 'WG Kaiserstraße',
  invitedByName: 'Lena',
  invitedByAvatarUrl: null,
  expiresAt: '2026-12-01T10:00:00Z',
  memberCount: 1,
  members: [{ firstName: 'Lena', avatarUrl: null }],
}

const service = vi.hoisted(() => ({
  preview: vi.fn<InvitesService['preview']>(),
  accept: vi.fn<InvitesService['accept']>(),
}))

vi.mock('@/stores/invites', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/invites')>()
  return { ...original, useInvitesStore: original.defineInvitesStore(service) }
})

async function mountDialog() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/invite/:token', name: 'invite', component: { template: '<p />' } }],
  })
  const wrapper = mount(JoinGroupDialog, {
    props: { open: false, 'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }) },
    global: { plugins: [createAppI18n(['en'], null), router] },
    attachTo: document.body,
  })
  await wrapper.setProps({ open: true })
  return { wrapper, router }
}

async function submit(wrapper: Awaited<ReturnType<typeof mountDialog>>['wrapper'], text: string) {
  await wrapper.get('input').setValue(text)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  service.preview.mockResolvedValue(PREVIEW)
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('JoinGroupDialog', () => {
  it('waits for a link: the button is disabled while the field is empty', async () => {
    const { wrapper } = await mountDialog()

    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('opens the invite page for a valid link and closes', async () => {
    const { wrapper, router } = await mountDialog()

    await submit(wrapper, LINK)

    expect(service.preview).toHaveBeenCalledWith(TOKEN)
    expect(router.currentRoute.value.name).toBe('invite')
    expect(router.currentRoute.value.params.token).toBe(TOKEN)
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('explains a text that is no invite link, without asking the server', async () => {
    const { wrapper } = await mountDialog()

    await submit(wrapper, 'https://mitbringsel.tinowolter.com/rezepte/hallo')

    expect(wrapper.get('[role="alert"]').text()).toContain('not a Mitbringsel invite link')
    expect(service.preview).not.toHaveBeenCalled()
    expect(wrapper.props('open')).toBe(true)
    wrapper.unmount()
  })

  it('says so when the link has expired, and clears the message when the text changes', async () => {
    service.preview.mockRejectedValue(new ApiError('INVITE_EXPIRED', 410))
    const { wrapper } = await mountDialog()

    await submit(wrapper, LINK)

    expect(wrapper.get('[role="alert"]').text()).toContain('expired')
    expect(wrapper.props('open')).toBe(true)

    await wrapper.get('input').setValue(`${LINK}x`)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('makes the user wait after a rate limit and counts down', async () => {
    vi.useFakeTimers()
    service.preview.mockRejectedValue(new ApiError('RATE_LIMITED', 429, 3))
    const { wrapper } = await mountDialog()

    await wrapper.get('input').setValue(LINK)
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const button = wrapper.get('button[type="submit"]')
    expect(wrapper.get('.limit').text()).toContain('3 seconds')
    expect(button.text()).toBe('Wait 3 s')
    expect(button.attributes('disabled')).toBeDefined()

    await vi.advanceTimersByTimeAsync(3000)

    expect(wrapper.find('.limit').exists()).toBe(false)
    expect(wrapper.get('button[type="submit"]').text()).toBe('Open invite')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('pastes from the clipboard', async () => {
    vi.stubGlobal('navigator', { clipboard: { readText: () => Promise.resolve(LINK) } })
    const { wrapper } = await mountDialog()

    await wrapper.get('.paste').trigger('click')
    await flushPromises()

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe(LINK)
    wrapper.unmount()
  })

  it('leaves the field alone when the clipboard cannot be read', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { readText: () => Promise.reject(new Error('denied')) },
    })
    const { wrapper } = await mountDialog()

    await wrapper.get('.paste').trigger('click')
    await flushPromises()

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
    wrapper.unmount()
  })
})
