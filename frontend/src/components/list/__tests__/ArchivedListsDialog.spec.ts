import { beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import type { List } from '@/types/api'

import ArchivedListsDialog from '../ArchivedListsDialog.vue'

function list(id: string, name: string): List {
  return {
    id,
    groupId: 'g1',
    name,
    archivedAt: '2026-02-01T10:00:00Z',
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

beforeEach(() => {
  // jsdom has no modal <dialog>.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

async function mountDialog(currentId = 'l1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/groups/:groupId/lists/:listId', name: 'list', component: {} }],
  })
  await router.push('/groups/g1/lists/l1')
  const wrapper = mount(ArchivedListsDialog, {
    props: {
      open: true,
      'onUpdate:open': (open: boolean) => wrapper.setProps({ open }),
      groupId: 'g1',
      lists: [list('l2', 'Grillparty'), list('l3', 'Umzug')],
      currentId,
    },
    global: { plugins: [createAppI18n(['en'], null), router] },
    attachTo: document.body,
  })
  return { wrapper, router }
}

describe('ArchivedListsDialog', () => {
  it('links every archived list', async () => {
    const { wrapper } = await mountDialog()

    const links = wrapper.findAll('a')
    expect(links.map((a) => a.text())).toEqual(['Grillparty', 'Umzug'])
    expect(links.map((a) => a.attributes('href'))).toEqual([
      '/groups/g1/lists/l2',
      '/groups/g1/lists/l3',
    ])
    wrapper.unmount()
  })

  it('marks the archived list that is open', async () => {
    const { wrapper } = await mountDialog('l3')

    const [first, second] = wrapper.findAll('a')
    expect(first!.attributes('aria-current')).toBeUndefined()
    expect(second!.attributes('aria-current')).toBe('page')
    wrapper.unmount()
  })

  it('opens a list and closes', async () => {
    const { wrapper, router } = await mountDialog()

    await wrapper.findAll('a')[0]!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.params.listId).toBe('l2')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
    wrapper.unmount()
  })
})
