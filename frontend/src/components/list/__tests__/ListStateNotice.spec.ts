import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import { createAppI18n } from '@/i18n'
import { ApiError } from '@/services/api/client'
import type { ListsService } from '@/services/api/lists'
import { useListsStore } from '@/stores/lists'

import ListStateNotice, { type ListNoticeState } from '../ListStateNotice.vue'

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

vi.mock('@/stores/lists', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/lists')>()
  return {
    ...original,
    useListsStore: original.defineListsStore(listsService, () => 'user-1', serverEvents),
  }
})

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  serverEvents.clear()
})

async function mountNotice(state: ListNoticeState) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/groups/:groupId', name: 'group', component: {} },
      { path: '/groups/:groupId/lists/:listId', name: 'list', component: {} },
    ],
  })
  await router.push('/groups/g1/lists/l9')
  const wrapper = mount(ListStateNotice, {
    props: { state, groupId: 'g1' },
    global: { plugins: [createAppI18n(['en'], null), router] },
  })
  return { wrapper, router }
}

describe('ListStateNotice', () => {
  it('says that the list is loading', async () => {
    const { wrapper } = await mountNotice('loading')

    expect(wrapper.get('[role="status"]').text()).toBe('Loading list …')
  })

  it('offers to load the lists again after an error', async () => {
    listsService.list.mockRejectedValueOnce(new ApiError('INTERNAL', 500))
    await useListsStore().load('g1')
    listsService.list.mockResolvedValue([])
    const { wrapper } = await mountNotice('failed')

    expect(wrapper.get('[role="alert"] .failed-title').text()).toBe('The list could not be loaded.')
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()

    expect(listsService.list).toHaveBeenCalledTimes(2)
  })

  it('leads back to the household when the list is missing', async () => {
    const { wrapper, router } = await mountNotice('missing')

    expect(wrapper.text()).toContain('List not found')
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('group')
  })

  it('asks to create the first list', async () => {
    const { wrapper } = await mountNotice('noLists')

    expect(wrapper.text()).toContain('No list yet')
    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('create')).toHaveLength(1)
  })
})
