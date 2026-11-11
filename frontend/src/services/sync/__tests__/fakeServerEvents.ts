import type { ServerEvents, ServerMessageHandler } from '@/services/sync/socket'
import type { ServerMessage, ServerMessageType } from '@/types/api'

/** A ServerEvents the test feeds by hand, instead of a WebSocket. */
export interface FakeServerEvents extends ServerEvents {
  /** Delivers the message to every handler registered for its type. */
  emit(message: ServerMessage): void
  /** How many handlers are registered for this type. */
  count(type: ServerMessageType): number
  /** Drops all handlers, e.g. between tests that share one fake. */
  clear(): void
}

type AnyHandler = (message: ServerMessage) => void

export function createFakeServerEvents(): FakeServerEvents {
  const handlers = new Map<ServerMessageType, Set<AnyHandler>>()

  return {
    on<T extends ServerMessageType>(type: T, handler: ServerMessageHandler<T>) {
      let set = handlers.get(type)
      if (!set) {
        set = new Set()
        handlers.set(type, set)
      }
      // Safe: this set only ever receives messages of `type` (see emit).
      const entry = handler as AnyHandler
      set.add(entry)
      return () => {
        set.delete(entry)
      }
    },

    emit(message) {
      for (const handler of [...(handlers.get(message.type) ?? [])]) {
        handler(message)
      }
    },

    count: (type) => handlers.get(type)?.size ?? 0,

    clear() {
      handlers.clear()
    },
  }
}
