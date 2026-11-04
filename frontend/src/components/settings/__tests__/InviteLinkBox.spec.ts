import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'

import InviteLinkBox from '../InviteLinkBox.vue'

const LINK = 'https://mitbringsel.tinowolter.com/invite/Kx9f2mQ7vLp3Zt8RnW4cYb6HdJs1Ua5EoN0gXiT7wBq'

const writeText = vi.fn<(text: string) => Promise<void>>()
const share = vi.fn<(data: ShareData) => Promise<void>>()

// jsdom has neither a clipboard nor a share sheet; each test says what the browser offers.
function setBrowser({ canShare }: { canShare: boolean }) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  Object.defineProperty(navigator, 'share', {
    value: canShare ? share : undefined,
    configurable: true,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  writeText.mockResolvedValue(undefined)
  share.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

function mountBox() {
  return mount(InviteLinkBox, {
    props: { link: LINK, groupName: 'WG Kaiserstraße' },
    global: { plugins: [createAppI18n(['en'], null)] },
  })
}

function buttonWithText(wrapper: ReturnType<typeof mountBox>, text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)
}

describe('InviteLinkBox', () => {
  it('shows the link without the protocol and says it is shown only now', () => {
    setBrowser({ canShare: false })
    const wrapper = mountBox()

    expect(wrapper.get('.link').text()).toBe(LINK.replace('https://', ''))
    expect(wrapper.get('.only-now').text()).toContain('You only see the link now.')
  })

  it('copies the full link and shows "Copied" for a moment', async () => {
    setBrowser({ canShare: false })
    const wrapper = mountBox()

    await buttonWithText(wrapper, 'Copy')!.trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledWith(LINK)
    expect(buttonWithText(wrapper, 'Copied')).toBeDefined()

    vi.advanceTimersByTime(2500)
    await flushPromises()

    expect(buttonWithText(wrapper, 'Copy')).toBeDefined()
  })

  it('asks to copy by hand when the browser refuses', async () => {
    setBrowser({ canShare: false })
    writeText.mockRejectedValueOnce(new Error('denied'))
    const wrapper = mountBox()

    await buttonWithText(wrapper, 'Copy')!.trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Copying did not work.')
    expect(buttonWithText(wrapper, 'Copied')).toBeUndefined()
  })

  it('offers sharing only where the browser can share, and shares the link', async () => {
    setBrowser({ canShare: false })
    expect(buttonWithText(mountBox(), 'Share')).toBeUndefined()

    setBrowser({ canShare: true })
    const wrapper = mountBox()
    await buttonWithText(wrapper, 'Share')!.trigger('click')

    expect(share).toHaveBeenCalledWith({ title: 'Invitation to “WG Kaiserstraße”', url: LINK })
  })

  it('does not mind when the share sheet is closed', async () => {
    setBrowser({ canShare: true })
    share.mockRejectedValueOnce(new DOMException('closed', 'AbortError'))
    const wrapper = mountBox()

    await buttonWithText(wrapper, 'Share')!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })
})
