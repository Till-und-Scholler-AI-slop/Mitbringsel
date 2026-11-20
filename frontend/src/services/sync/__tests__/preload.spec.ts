import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'

import type { ServerMessage } from '@/types/api'

import { installPreload, type PreloadTarget } from '../preload'
import { createFakeServerEvents } from './fakeServerEvents'

const READY: ServerMessage = { type: 'ready' }

/** A promise the test settles by hand, to look at the state in between. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/**
 * Stores with two households: g1 has the active lists l1 and l2, g2 has l3.
 * Every load works; tests override single functions.
 */
function fakeTarget() {
  const user = { id: 'anna' as string | null }
  const covered: Record<string, string[]> = { g1: ['l1', 'l2'], g2: ['l3'] }
  return {
    user,
    userId: vi.fn<PreloadTarget['userId']>(() => user.id),
    loadGroups: vi.fn<PreloadTarget['loadGroups']>(() => Promise.resolve()),
    groupIds: vi.fn<PreloadTarget['groupIds']>(() => ['g1', 'g2']),
    loadLists: vi.fn<PreloadTarget['loadLists']>(() => Promise.resolve()),
    loadGroupItems: vi.fn<PreloadTarget['loadGroupItems']>((groupId) =>
      Promise.resolve(covered[groupId] ?? []),
    ),
    reloadItems: vi.fn<PreloadTarget['reloadItems']>(),
  }
}

function setup(target = fakeTarget()) {
  const events = createFakeServerEvents()
  const stop = installPreload(events, target)
  return { target, events, stop }
}

describe('installPreload', () => {
  it('loads nothing before ready', async () => {
    const { target } = setup()
    await flushPromises()

    expect(target.loadGroups).not.toHaveBeenCalled()
  })

  it('loads the lists and items of every household after ready', async () => {
    const { target, events } = setup()

    events.emit(READY)
    await flushPromises()

    expect(target.loadGroups).toHaveBeenCalledTimes(1)
    expect(target.loadLists.mock.calls).toEqual([['g1'], ['g2']])
    expect(target.loadGroupItems.mock.calls).toEqual([['g1'], ['g2']])
  })

  it('takes the households only once they are loaded', async () => {
    const target = fakeTarget()
    const groups = deferred<void>()
    target.loadGroups.mockReturnValueOnce(groups.promise)
    const { events } = setup(target)

    events.emit(READY)
    await flushPromises()
    expect(target.groupIds).not.toHaveBeenCalled()

    groups.resolve()
    await flushPromises()
    expect(target.loadLists).toHaveBeenCalledTimes(2)
  })

  it('reloads the other loaded items after the households answered', async () => {
    const target = fakeTarget()
    const g2 = deferred<string[] | null>()
    target.loadGroupItems.mockImplementation((groupId) =>
      groupId === 'g2' ? g2.promise : Promise.resolve(['l1', 'l2']),
    )
    const { events } = setup(target)

    events.emit(READY)
    await flushPromises()
    expect(target.reloadItems).not.toHaveBeenCalled()

    g2.resolve(['l3'])
    await flushPromises()
    expect(target.reloadItems).toHaveBeenCalledWith(new Set(['l1', 'l2', 'l3']))
  })

  it('reloads the lists of a household whose request failed one by one', async () => {
    const target = fakeTarget()
    target.loadGroupItems.mockImplementation((groupId) =>
      Promise.resolve(groupId === 'g1' ? null : ['l3']),
    )
    const { events } = setup(target)

    events.emit(READY)
    await flushPromises()

    expect(target.reloadItems).toHaveBeenCalledWith(new Set(['l3']))
  })

  it('does nothing while nobody is signed in', async () => {
    const target = fakeTarget()
    target.user.id = null
    const { events } = setup(target)

    events.emit(READY)
    await flushPromises()

    expect(target.loadGroups).not.toHaveBeenCalled()
  })

  it('stops when another user signed in while the households loaded', async () => {
    const target = fakeTarget()
    const groups = deferred<void>()
    target.loadGroups.mockReturnValueOnce(groups.promise)
    const { events } = setup(target)

    events.emit(READY)
    target.user.id = 'ben'
    groups.resolve()
    await flushPromises()

    expect(target.loadLists).not.toHaveBeenCalled()
    expect(target.loadGroupItems).not.toHaveBeenCalled()
  })

  it('does not reload items for another user who signed in meanwhile', async () => {
    const target = fakeTarget()
    const items = deferred<string[] | null>()
    target.loadGroupItems.mockReturnValue(items.promise)
    const { events } = setup(target)

    events.emit(READY)
    await flushPromises()
    target.user.id = 'ben'
    items.resolve(['l1'])
    await flushPromises()

    expect(target.reloadItems).not.toHaveBeenCalled()
  })

  it('stops listening when stopped', async () => {
    const { target, events, stop } = setup()

    stop()
    events.emit(READY)
    await flushPromises()

    expect(events.count('ready')).toBe(0)
    expect(target.loadGroups).not.toHaveBeenCalled()
  })
})
