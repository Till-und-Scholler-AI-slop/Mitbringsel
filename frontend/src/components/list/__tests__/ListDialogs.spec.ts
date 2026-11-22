import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import type { GroupsService } from '@/services/api/groups'
import type { ListsService } from '@/services/api/lists'
import { useGroupsStore } from '@/stores/groups'
import { useListsStore } from '@/stores/lists'
import type { Group, List } from '@/types/api'

import ListDialogs from '../ListDialogs.vue'

const groupsService = vi.hoisted(() => ({
  list: vi.fn<GroupsService['list']>(),
  create: vi.fn<GroupsService['create']>(),
  rename: vi.fn<GroupsService['rename']>(),
  remove: vi.fn<GroupsService['remove']>(),
  removeMember: vi.fn<GroupsService['removeMember']>(),
  setMemberRole: vi.fn<GroupsService['setMemberRole']>(),
}))

const listsService = vi.hoisted(() => ({
  list: vi.fn<ListsService['list']>(),
  create: vi.fn<ListsService['create']>(),
  update: vi.fn<ListsService['update']>(),
  setArchived: vi.fn<ListsService['setArchived']>(),
  remove: vi.fn<ListsService['remove']>(),
}))

// vi.hoisted runs before the imports, so the fake has to be imported by hand.
const serverEvents = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeServerEvents')).createFakeServerEvents(),
)

vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return {
    ...original,
    useGroupsStore: original.defineGroupsStore(groupsService, () => 'user-1', serverEvents),
  }
})

vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return {
    ...original,
    useListsStore: original.defineListsStore(listsService, () => 'user-1', serverEvents),
  }
})

const GROUP: Group = {
  id: 'g1',
  name: 'WG Kaiserstraße',
  role: 'owner',
  members: [],
  createdAt: '2026-01-01T10:00:00Z',
  updatedAt: '2026-01-01T10:00:00Z',
}

function list(id: string, name: string, archivedAt: string | null = null): List {
  return {
    id,
    groupId: 'g1',
    name,
    icon: 'general',
    archivedAt,
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
    serverSeq: 1,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
  // jsdom has no modal <dialog>.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

async function mountDialogs() {
  groupsService.list.mockResolvedValue([GROUP])
  listsService.list.mockResolvedValue([
    list('l1', 'Supermarkt'),
    list('l2', 'Baumarkt'),
    list('l3', 'Umzug', '2026-02-01T10:00:00Z'),
  ])
  await useGroupsStore().load()
  await useListsStore().load('g1')
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/groups/:groupId/lists/:listId', name: 'list', component: {} }],
  })
  await router.push('/groups/g1/lists/l1')
  const wrapper = mount(ListDialogs, {
    props: { groupId: 'g1', currentId: 'l1' },
    global: { plugins: [createAppI18n(['en'], null), router] },
    attachTo: document.body,
  })
  return { wrapper, router }
}

const openTitles = () =>
  [...document.querySelectorAll('dialog[open] h2')].map((h) => h.textContent?.trim())

describe('ListDialogs', () => {
  it('shows no dialog until one is opened', async () => {
    const { wrapper } = await mountDialogs()

    expect(openTitles()).toEqual([])
    wrapper.unmount()
  })

  it('opens the dialog to create a list', async () => {
    const { wrapper } = await mountDialogs()

    wrapper.vm.openCreate()
    await flushPromises()

    expect(openTitles()).toEqual(['New list'])
    wrapper.unmount()
  })

  it('opens the archive with the archived lists', async () => {
    const { wrapper } = await mountDialogs()

    wrapper.vm.openArchive()
    await flushPromises()

    expect(openTitles()).toEqual(['Archived lists'])
    expect([...document.querySelectorAll('dialog[open] a')].map((a) => a.textContent)).toEqual([
      'Umzug',
    ])
    wrapper.unmount()
  })

  it('goes from the actions of a list to renaming it', async () => {
    const { wrapper } = await mountDialogs()

    wrapper.vm.openActions('l2')
    await flushPromises()
    expect(openTitles()).toEqual(['Manage list'])
    expect(document.querySelector('dialog[open] .question')?.textContent).toContain('Baumarkt')

    const rename = [...document.querySelectorAll<HTMLButtonElement>('dialog[open] .action')].find(
      (b) => b.textContent?.includes('Edit'),
    )
    rename!.click()
    await flushPromises()

    expect(openTitles()).toEqual(['Edit list'])
    wrapper.unmount()
  })

  it('closes every dialog when the open list changes', async () => {
    const { wrapper } = await mountDialogs()

    wrapper.vm.openActions('l2')
    await flushPromises()
    await wrapper.setProps({ currentId: 'l2' })
    await flushPromises()

    expect(openTitles()).toEqual([])
    wrapper.unmount()
  })
})
