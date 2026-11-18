/**
 * Coalesces writes to the local storage. A store calls schedule() wherever
 * its state changes; per key only the newest write runs, once, after the
 * current task's synchronous code (a microtask). An event that deletes 50
 * items thus writes their list once, not 50 times.
 *
 * A write reads the state when it runs, not when it is scheduled, so it
 * always stores the newest state. clear() drops what has not run yet, e.g.
 * when the user changes and the old user's state must not be written.
 *
 * Writes never throw (localData turns failures into warnings), so the queue
 * does not wait for them or handle their errors.
 */
export interface PersistQueue {
  schedule(key: string, write: () => unknown): void
  clear(): void
}

export function createPersistQueue(): PersistQueue {
  const pending = new Map<string, () => unknown>()
  let scheduled = false

  function run() {
    scheduled = false
    const writes = [...pending.values()]
    pending.clear()
    for (const write of writes) {
      write()
    }
  }

  return {
    schedule(key, write) {
      pending.set(key, write)
      if (!scheduled) {
        scheduled = true
        queueMicrotask(run)
      }
    },
    clear() {
      pending.clear()
    },
  }
}
