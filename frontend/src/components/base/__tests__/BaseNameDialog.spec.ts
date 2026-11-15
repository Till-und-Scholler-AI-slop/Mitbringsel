import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'

import BaseNameDialog, { type NameProblem } from '../BaseNameDialog.vue'

const MAX_LENGTH = 10

function validate(name: string): NameProblem | null {
  const length = Array.from(name.trim()).length
  if (length === 0) return 'empty'
  if (length > MAX_LENGTH) return 'tooLong'
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

function mountDialog(options?: {
  open?: boolean
  initialName?: string
  changed?: boolean
  tooLongError?: string | ((excess: number) => string)
  save?: (name: string) => Promise<void>
}) {
  const save = options?.save ?? vi.fn<(name: string) => Promise<void>>().mockResolvedValue()
  const wrapper = mount(BaseNameDialog, {
    props: {
      open: options?.open ?? true,
      title: 'Dialog title',
      label: 'Name',
      placeholder: 'Placeholder',
      hint: 'Hint',
      cancelLabel: 'Cancel',
      submitLabel: 'Save',
      maxLength: MAX_LENGTH,
      tooLongError: options?.tooLongError ?? 'Too long',
      initialName: options?.initialName,
      changed: options?.changed,
      validate,
      save,
      'onUpdate:open': (value: boolean) => wrapper.setProps({ open: value }),
    },
    slots: { default: '<p class="extra">Extra field</p>' },
    global: { plugins: [createAppI18n(['en'], null)] },
    attachTo: document.body,
  })
  return { wrapper, save }
}

const inputEl = (wrapper: ReturnType<typeof mountDialog>['wrapper']) =>
  wrapper.get('input').element as HTMLInputElement

describe('BaseNameDialog', () => {
  it('starts empty and disables submit until a valid name is typed', async () => {
    const { wrapper, save } = mountDialog()

    expect(inputEl(wrapper).value).toBe('')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()

    await wrapper.get('input').setValue('  Bread  ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(save).toHaveBeenCalledWith('Bread')
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('starts with initialName when mounted open and closes without saving if unchanged', async () => {
    const { wrapper, save } = mountDialog({ open: true, initialName: 'Market' })

    expect(inputEl(wrapper).value).toBe('Market')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(save).not.toHaveBeenCalled()
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('saves an unchanged name when another field changed', async () => {
    const { wrapper, save } = mountDialog({ open: true, initialName: 'Market', changed: true })

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(save).toHaveBeenCalledWith('Market')
    expect(wrapper.props('open')).toBe(false)
    wrapper.unmount()
  })

  it('shows extra fields below the name, inside the form', () => {
    const { wrapper } = mountDialog()

    expect(wrapper.get('form .extra').text()).toBe('Extra field')
    wrapper.unmount()
  })

  it('shows tooLongError while typing and blocks submit', async () => {
    const { wrapper, save } = mountDialog()

    await wrapper.get('input').setValue('x'.repeat(MAX_LENGTH + 1))
    await wrapper.get('form').trigger('submit')

    expect(wrapper.get('[role="alert"]').text()).toContain('Too long')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(save).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('builds tooLongError from how many characters are too many', async () => {
    const { wrapper } = mountDialog({ tooLongError: (excess) => `Cut ${excess}` })

    // Spaces around the name do not count; an emoji is one character.
    await wrapper.get('input').setValue(`  ${'x'.repeat(MAX_LENGTH + 1)}🥖  `)

    expect(wrapper.get('[role="alert"]').text()).toContain('Cut 2')
    wrapper.unmount()
  })

  it('shows server error while staying open, and clears it when input changes', async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError('NETWORK'))
    const { wrapper } = mountDialog({ save })

    await wrapper.get('input').setValue('Market')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('The server cannot be reached.')
    expect(wrapper.props('open')).toBe(true)

    await wrapper.get('input').setValue('Market 2')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('resets input and error when reopened', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('boom'))
    const { wrapper } = mountDialog({ initialName: 'Old', save })

    await wrapper.get('input').setValue('Draft')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(inputEl(wrapper).value).toBe('Old')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
