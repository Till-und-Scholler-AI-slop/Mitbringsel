import type { ServerEvents, Unsubscribe } from './socket'

/**
 * What the preload needs from the stores; main.ts wires the real ones, tests
 * pass a fake.
 */
export interface PreloadTarget {
  /** The ID of the signed-in user, or null. */
  userId(): string | null
  /** Loads the households of the user (never throws). */
  loadGroups(): Promise<void>
  /** The IDs of the households the store holds now. */
  groupIds(): string[]
  /** Loads the lists of a household, archived ones included (never throws). */
  loadLists(groupId: string): Promise<void>
  /** Loads the items of every active list of a household; the lists it covered, or null. */
  loadGroupItems(groupId: string): Promise<string[] | null>
  /** Loads again every list whose items were loaded, except those in `skip`. */
  reloadItems(skip: ReadonlySet<string>): void
}

/**
 * Loads households, lists and items again after every `ready` of the socket
 * (ADR 0006, docs/sync.md): events are best effort and the connection may
 * have been down, so everything may be outdated. It loads the lists and the
 * items of every household, not only of those the user opened, so the device
 * has all of them when the network goes away.
 *
 * The items of a household come in one request. Lists it does not cover
 * (archived lists the user opened, households whose request failed) load
 * one by one, as far as they were loaded before.
 *
 * Only on `ready`, not at the start: with a network, `ready` follows the
 * sign-in at once, and without one there is nothing to load. Returns a
 * function that stops listening.
 */
export function installPreload(events: ServerEvents, target: PreloadTarget): Unsubscribe {
  async function preload() {
    const userId = target.userId()
    if (!userId) {
      return
    }
    await target.loadGroups()
    // Another user signed in meanwhile: these are not their households,
    // and their own `ready` starts their preload.
    if (target.userId() !== userId) {
      return
    }
    const covered = await Promise.all(
      target.groupIds().map(async (groupId) => {
        const [, listIds] = await Promise.all([
          target.loadLists(groupId),
          target.loadGroupItems(groupId),
        ])
        return listIds ?? []
      }),
    )
    if (target.userId() !== userId) {
      return
    }
    target.reloadItems(new Set(covered.flat()))
  }

  return events.on('ready', () => {
    void preload()
  })
}
