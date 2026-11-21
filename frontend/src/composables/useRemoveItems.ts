import { useI18n } from 'vue-i18n'

import { useErrorText } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { useItemsStore, type PendingRemoval } from '@/stores/items'
import { useToastsStore } from '@/stores/toasts'

/**
 * Removes items for every member without asking first: the checked items of
 * a list (design "markt2-erledigt-entfernen") or one item from its form.
 * The items disappear at once and a toast offers "Undo". The toast's clock
 * decides: undo shows the items again, every other end of the toast (time
 * out, closed, pushed out by a newer one) commits the removal. So hovering
 * the toast also holds the removal back, as undo must work as long as it is
 * offered.
 *
 * Removing one item puts it into the outbox; a refusal reaches
 * useItemRejections. Removing checked items still sends directly (#133).
 *
 * The removal belongs to the stores, not to the view: leaving the list
 * before the toast ends still commits it.
 */
export function useRemoveItems() {
  const { t } = useI18n()
  const errorText = useErrorText()
  const items = useItemsStore()
  const toasts = useToastsStore()

  async function send(removal: PendingRemoval, failedText: string) {
    try {
      await removal.commit()
    } catch (err) {
      toasts.show({
        kind: 'error',
        text: failedText,
        detail: errorText(err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN),
      })
    }
  }

  // `fromKeyboard` moves the focus to "Undo" in the toast, as a keyboard
  // user would otherwise have to search for it.
  function offerUndo(removal: PendingRemoval, fromKeyboard: boolean, commit: () => void) {
    const [only] = removal.items
    const count = removal.items.length
    toasts.show({
      kind: 'success',
      icon: 'trash',
      // One item is named, as the user may not remember which one it was.
      text:
        count === 1 && only
          ? t('list.done.removedOne', { name: only.name })
          : t('list.done.removed', { count }),
      actionLabel: t('list.done.undo'),
      focusAction: fromKeyboard,
      onEnd: (reason) => (reason === 'action' ? removal.undo() : commit()),
    })
  }

  /** Removes the checked items of the list; nothing happens without any. */
  function removeChecked(listId: string, fromKeyboard = false) {
    const removal = items.startRemovingChecked(listId)
    if (removal) {
      offerUndo(removal, fromKeyboard, () => void send(removal, t('list.done.removeFailed')))
    }
  }

  /** Removes one item, open or checked; nothing happens if it is gone. */
  function removeItem(itemId: string, fromKeyboard = false) {
    const removal = items.startRemovingItem(itemId)
    if (removal) offerUndo(removal, fromKeyboard, () => void removal.commit())
  }

  return { removeChecked, removeItem }
}
