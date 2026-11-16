import { describe, expect, it, vi } from 'vitest'

import { createPersistQueue } from '../persistQueue'

describe('persistQueue', () => {
  it('runs a write after the synchronous code, not at once', async () => {
    const queue = createPersistQueue()
    const write = vi.fn()

    queue.schedule('a', write)
    expect(write).not.toHaveBeenCalled()

    await Promise.resolve()
    expect(write).toHaveBeenCalledOnce()
  })

  it('runs only the newest write per key', async () => {
    const queue = createPersistQueue()
    const first = vi.fn()
    const second = vi.fn()

    queue.schedule('a', first)
    queue.schedule('a', second)
    await Promise.resolve()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('runs one write for each key', async () => {
    const queue = createPersistQueue()
    const a = vi.fn()
    const b = vi.fn()

    queue.schedule('a', a)
    queue.schedule('b', b)
    await Promise.resolve()

    expect(a).toHaveBeenCalledOnce()
    expect(b).toHaveBeenCalledOnce()
  })

  it('reads the state when the write runs', async () => {
    const queue = createPersistQueue()
    let state = 1
    const written: number[] = []

    queue.schedule('a', () => written.push(state))
    state = 2
    await Promise.resolve()

    expect(written).toEqual([2])
  })

  it('schedules again after a run', async () => {
    const queue = createPersistQueue()
    const write = vi.fn()

    queue.schedule('a', write)
    await Promise.resolve()
    queue.schedule('a', write)
    await Promise.resolve()

    expect(write).toHaveBeenCalledTimes(2)
  })

  it('drops pending writes on clear', async () => {
    const queue = createPersistQueue()
    const write = vi.fn()

    queue.schedule('a', write)
    queue.clear()
    await Promise.resolve()

    expect(write).not.toHaveBeenCalled()
  })
})
