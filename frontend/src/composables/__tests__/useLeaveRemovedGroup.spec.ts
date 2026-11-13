import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { createAppI18n } from '@/i18n'
import type { GroupsService } from '@/services/api/groups'
import { useGroupsStore } from '@/stores/groups'
import { useToastsStore } from '@/stores/toasts'
import type { Group, ServerMessage } from '@/types/api'

import { useLeaveRemovedGroup } from '../useLeaveRemovedGroup'

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

// vi.hoisted runs before the imports, so the fake has to be imported by hand.
const serverEvents = await vi.hoisted(async () =>
  (await import('@/services/sync/__tests__/fakeServerEvents')).createFakeServerEvents(),
)

// The lists store is not needed: the group's lists are dropped by a no-op.
vi.mock('@/stores/groups', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/groups')>()
  return {
    ...original,
    useGroupsStore: original.defineGroupsStore(
      groupsService,
      () => 'user-1',
      serverEvents,
      () => {},
    ),
  }
})

function group(id: string, name: string): Group {
  return {
    id,
    name,
    role: 'member',
    members: [],
    createdAt: '2026-01-01T10:00:00Z',
    updatedAt: '2026-01-01T10:00:00Z',
  }
}

const removal = (reason: 'removed' | 'deleted', actorId: string): ServerMessage => ({
  type: 'groupRemoved',
  payload: { groupId: 'g1', reason, actorId },
})

// A screen of household g1 behind a real router, as in the app.
async function openHousehold(locale: 'de' | 'en' = 'de') {
  const Household = defineComponent({
    setup() {
      useLeaveRemovedGroup(() => 'g1')
      return () => h('p', 'household')
    },
  })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { render: () => h('p', 'home') } },
      { path: '/groups/:groupId', name: 'group', component: Household },
    ],
  })
  await router.push('/groups/g1')
  mount(
    { render: () => h(RouterView) },
    { global: { plugins: [createAppI18n([locale], null), router] } },
  )
  await useGroupsStore().load()
  await flushPromises()
  return { router, toasts: useToastsStore() }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
  groupsService.list.mockResolvedValue([group('g1', 'WG Kaiserstraße 12')])
  groupsService.remove.mockResolvedValue()
})

describe('useLeaveRemovedGroup', () => {
  it.each([
    ['removed', 'Du wurdest aus ‚WG Kaiserstraße 12‘ entfernt'],
    ['deleted', '‚WG Kaiserstraße 12‘ wurde gelöscht'],
  ] as const)('goes to the start page and says the household was %s', async (reason, text) => {
    const { router, toasts } = await openHousehold()

    serverEvents.emit(removal(reason, OTHER))
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
    expect(toasts.toasts).toMatchObject([{ kind: 'info', text }])
  })

  it('says so in English', async () => {
    const { toasts } = await openHousehold('en')

    serverEvents.emit(removal('removed', OTHER))
    await flushPromises()

    expect(toasts.toasts[0]?.text).toBe('You were removed from ‘WG Kaiserstraße 12’')
  })

  it('says the user is no longer in it when a reload drops it', async () => {
    const { router, toasts } = await openHousehold()

    groupsService.list.mockResolvedValue([])
    await useGroupsStore().load()
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
    expect(toasts.toasts[0]?.text).toBe('Du bist nicht mehr in ‚WG Kaiserstraße 12‘')
  })

  it('stays quiet when the user deleted it in this tab', async () => {
    const { router, toasts } = await openHousehold()

    await useGroupsStore().remove('g1')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
    expect(toasts.toasts).toEqual([])
  })

  it('stays quiet when the user left it in another tab', async () => {
    const { router, toasts } = await openHousehold()

    serverEvents.emit(removal('removed', ME))
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('home')
    expect(toasts.toasts).toEqual([])
  })
})
