import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { computed, defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { createAppI18n } from '@/i18n'
import type { GroupsService } from '@/services/api/groups'
import type { ListsService } from '@/services/api/lists'
import { useGroupsStore } from '@/stores/groups'
import { useListsStore } from '@/stores/lists'
import { useToastsStore } from '@/stores/toasts'
import type { Group, List, ServerMessage } from '@/types/api'

import { useLeaveDeletedList } from '../useLeaveDeletedList'

const ME = 'user-1'
const OTHER = 'user-2'

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
  rename: vi.fn<ListsService['rename']>(),
  setArchived: vi.fn<ListsService['setArchived']>(),
  remove: vi.fn<ListsService['remove']>(),
}))

const serverEvents = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeServerEvents')).createFakeServerEvents(),
)

vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return {
    ...original,
    useGroupsStore: original.defineGroupsStore(
      groupsService,
      () => ME,
      serverEvents,
      () => {},
    ),
  }
})

vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return {
    ...original,
    useListsStore: original.defineListsStore(
      listsService,
      () => ME,
      serverEvents,
      () => {},
    ),
  }
})

const group: Group = {
  id: 'g1',
  name: 'WG',
  role: 'owner',
  members: [],
  createdAt: '2026-01-01T10:00:00Z',
  updatedAt: '2026-01-01T10:00:00Z',
}

const list = (id: string, name: string): List => ({
  id,
  groupId: 'g1',
  name,
  archivedAt: null,
  createdAt: '2026-01-01T10:00:00Z',
  updatedAt: '2026-01-01T10:00:00Z',
  serverSeq: 1,
})

const deleted = (listId: string, actorId = OTHER): ServerMessage => ({
  type: 'listDeleted',
  payload: { groupId: 'g1', listId, actorId },
})

async function openList(locale: 'de' | 'en' = 'de') {
  const ListPage = defineComponent({
    props: { groupId: { type: String, required: true }, listId: String },
    setup(props) {
      const groupsStore = useGroupsStore()
      const listsStore = useListsStore()
      const currentGroup = computed(() => groupsStore.byId(props.groupId))
      const currentList = computed(() => (props.listId ? listsStore.byId(props.listId) : undefined))
      useLeaveDeletedList(
        () => props.groupId,
        () => props.listId,
        currentList,
        currentGroup,
      )
      return () => h('p', 'list')
    },
  })

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/groups/:groupId', name: 'group', component: ListPage, props: true },
      { path: '/groups/:groupId/lists/:listId', name: 'list', component: ListPage, props: true },
    ],
  })
  await router.push('/groups/g1/lists/l1')
  mount(
    { render: () => h(RouterView) },
    { global: { plugins: [createAppI18n([locale], null), router] } },
  )
  await useGroupsStore().load()
  await useListsStore().load('g1')
  await flushPromises()
  return { router, lists: useListsStore(), toasts: useToastsStore() }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
  groupsService.list.mockResolvedValue([group])
  listsService.list.mockResolvedValue([list('l1', 'Supermarkt')])
  listsService.remove.mockResolvedValue(undefined)
})

describe('useLeaveDeletedList', () => {
  it('moves to the group route and shows a toast when another member deletes the list', async () => {
    const { router, toasts } = await openList()

    serverEvents.emit(deleted('l1'))
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('group')
    expect(toasts.toasts).toMatchObject([{ kind: 'info', text: '„Supermarkt“ wurde gelöscht' }])
  })

  it('says so in English', async () => {
    const { toasts } = await openList('en')

    serverEvents.emit(deleted('l1'))
    await flushPromises()

    expect(toasts.toasts[0]?.text).toBe('“Supermarkt” was deleted')
  })

  it('shows no toast when the user deletes the list themselves', async () => {
    const { router, lists, toasts } = await openList()

    await lists.remove('l1')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('group')
    expect(toasts.toasts).toEqual([])
  })

  it('does not redirect to group when the household itself went away', async () => {
    const { router, toasts } = await openList()
    const replace = vi.spyOn(router, 'replace')

    serverEvents.emit({
      type: 'groupRemoved',
      payload: { groupId: 'g1', reason: 'deleted', actorId: OTHER },
    })
    await flushPromises()

    expect(replace).not.toHaveBeenCalled()
    expect(toasts.toasts).toEqual([])
  })
})
