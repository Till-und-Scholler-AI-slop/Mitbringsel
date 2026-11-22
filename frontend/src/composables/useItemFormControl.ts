import { computed, inject, nextTick, provide, ref, watch, type InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'

import { ITEM_PANEL_QUERY } from '@/components/list/itemPanel'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useRemoveItems } from '@/composables/useRemoveItems'
import { useGroupsStore } from '@/stores/groups'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import { useToastsStore } from '@/stores/toasts'
import type { Item, List } from '@/types/api'

/** What the panel offers to the control: moving the focus into its form. */
export interface ItemFormPanelHandle {
  focusName(): void
}

/**
 * Which item form is open in the list view, and how it opens and closes: a
 * form for a new item (with the name typed into the quick-add bar) or for
 * editing an item. Below ITEM_PANEL_QUERY the form is a dialog, from it on a
 * panel next to the list; the panel is no dialog, so the control gives the
 * focus back itself when it closes.
 *
 * ListView creates it with provideItemFormControl; the parts of the view
 * that open the form (ListItems) or show it (ItemFormHost) take it with
 * useItemFormControl. The state belongs to the screen, not to the data, so
 * it lives as long as the view and not in a store.
 *
 * `list` is the open list. Switching lists closes the form.
 */
function createItemFormControl(list: () => List | undefined) {
  const { t } = useI18n()
  const groups = useGroupsStore()
  const items = useItemsStore()
  const lists = useListsStore()
  const toasts = useToastsStore()
  const { removeItem } = useRemoveItems()

  const panelMode = useMediaQuery(ITEM_PANEL_QUERY)
  // Set by ItemFormHost while the panel is shown.
  const panel = ref<ItemFormPanelHandle | null>(null)
  // Where the focus goes back to when the panel closes. A dialog does that
  // itself.
  let opener: HTMLElement | null = null

  // The form for a new item. The key changes with every opening, so the panel
  // starts afresh even if it was open already.
  const newItemOpen = ref(false)
  const newItemName = ref('')
  const newItemKey = ref(0)
  // The item whose form is open, and its name for the case that someone else
  // deletes it meanwhile.
  const editingId = ref<string | null>(null)
  let editingName = ''
  const editing = computed(() => (editingId.value ? items.byId(editingId.value) : undefined))

  // The panel stays open while the list is used beside it, so opening the
  // form for something else just switches it.
  function rememberOpener() {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) opener = active
  }

  function startEdit(item: Item) {
    rememberOpener()
    newItemOpen.value = false
    if (editingId.value === item.id) {
      panel.value?.focusName()
      return
    }
    editingName = item.name
    editingId.value = item.id
  }

  function openNew(name: string) {
    rememberOpener()
    editingId.value = null
    newItemName.value = name
    newItemKey.value++
    newItemOpen.value = true
  }

  // On the panel the focus goes back to where the form was opened from, if
  // that is still there (a deleted item takes its row along).
  async function close() {
    newItemOpen.value = false
    editingId.value = null
    if (!panelMode.value) return
    const target = opener
    opener = null
    await nextTick()
    if (target?.isConnected) target.focus()
  }

  // Deleting closes the form; the list offers undo in a toast.
  function removeEditing(fromKeyboard: boolean) {
    const id = editingId.value
    void close()
    if (id) removeItem(id, fromKeyboard)
  }

  // Registered before watch(editing) so switching lists clears editingId
  // before editing becomes undefined and would show the deleted toast.
  watch(
    () => list()?.id,
    () => {
      newItemOpen.value = false
      editingId.value = null
    },
  )

  // Someone else deleted the item while its form was open: the form has
  // nothing left to save, so it closes and says why. If the list or household
  // itself went away, their own toast explains it instead.
  watch(editing, (now, before) => {
    const current = list()
    if (
      before &&
      !now &&
      editingId.value &&
      current &&
      !lists.deletionOf(current.id) &&
      !groups.departureOf(current.groupId)
    ) {
      editingId.value = null
      toasts.show({
        kind: 'info',
        text: t('list.itemForm.deletedMeanwhile', { name: editingName }),
      })
    }
  })

  return {
    panelMode,
    panel,
    newItemOpen,
    newItemName,
    newItemKey,
    editingId,
    editing,
    startEdit,
    openNew,
    close,
    removeEditing,
  }
}

export type ItemFormControl = ReturnType<typeof createItemFormControl>

// An InjectionKey is a unique Symbol that carries the type, so inject()
// returns an ItemFormControl and not `unknown`.
const ITEM_FORM_CONTROL: InjectionKey<ItemFormControl> = Symbol('itemFormControl')

/** Creates the control and hands it to all components below the caller. */
export function provideItemFormControl(list: () => List | undefined): ItemFormControl {
  const control = createItemFormControl(list)
  provide(ITEM_FORM_CONTROL, control)
  return control
}

/** The control of the surrounding list view. */
export function useItemFormControl(): ItemFormControl {
  const control = inject(ITEM_FORM_CONTROL)
  if (!control) throw new Error('useItemFormControl() needs provideItemFormControl() in a parent')
  return control
}
