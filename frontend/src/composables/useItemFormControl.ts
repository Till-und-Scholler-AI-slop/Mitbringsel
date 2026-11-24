import { computed, inject, nextTick, provide, ref, watch, type InjectionKey } from 'vue'
import { useI18n } from 'vue-i18n'

import { CONTEXT_COLUMN_QUERY } from '@/components/list/contextColumn'
import { useMediaQuery } from '@/composables/useMediaQuery'
import { useRemoveItems } from '@/composables/useRemoveItems'
import { useGroupsStore } from '@/stores/groups'
import { useItemsStore } from '@/stores/items'
import { useListsStore } from '@/stores/lists'
import { useToastsStore } from '@/stores/toasts'
import type { Item, List } from '@/types/api'

/** What the form card offers to the control: moving the focus into its form. */
export interface ItemFormCardHandle {
  focusName(): void
}

/** What the overview card offers to the control: moving the focus into it. */
export interface OverviewCardHandle {
  focusStart(): void
}

/**
 * Which item form is open in the list view, and how it opens and closes: a
 * form for a new item (with the name typed into the quick-add bar) or for
 * editing an item. Below CONTEXT_COLUMN_QUERY the form is a dialog, from it on
 * a card in the context column next to the list. The card is always there:
 * "closed" means it shows an empty form for a new item. It is no dialog, so
 * the control gives the focus back itself when the form closes.
 *
 * ListView creates it with provideItemFormControl; the parts of the view
 * that open the form (ListItems) or show it (ItemFormHost) take it with
 * useItemFormControl. The state belongs to the screen, not to the data, so
 * it lives as long as the view and not in a store.
 *
 * With an overview card above it (`hasOverview`) one of the two cards is
 * collapsed to a bar: the overview is open after loading and whenever the form
 * closes, the form opens for a new or edited item.
 *
 * `list` is the open list. Switching lists closes the form.
 */
function createItemFormControl(list: () => List | undefined, hasOverview: () => boolean) {
  const { t } = useI18n()
  const groups = useGroupsStore()
  const items = useItemsStore()
  const lists = useListsStore()
  const toasts = useToastsStore()
  const { removeItem } = useRemoveItems()

  const columnMode = useMediaQuery(CONTEXT_COLUMN_QUERY)
  // Set by ItemFormHost while the card is shown.
  const card = ref<ItemFormCardHandle | null>(null)
  const overviewCard = ref<OverviewCardHandle | null>(null)
  // Which card of the column is open. Not remembered: the overview is open
  // after every load (ADR 0008).
  const expanded = ref<'overview' | 'form'>('overview')
  // Without an overview the form card is the only one and always open.
  const formExpanded = computed(() => !hasOverview() || expanded.value === 'form')
  // Where the focus goes back to when the card's form closes. A dialog does
  // that itself.
  let opener: HTMLElement | null = null

  // The form for a new item. The key changes with every opening and closing,
  // so the card starts afresh even if it showed a new item already.
  const newItemOpen = ref(false)
  const newItemName = ref('')
  const newItemKey = ref(0)
  // The item whose form is open, and its name for the case that someone else
  // deletes it meanwhile.
  const editingId = ref<string | null>(null)
  let editingName = ''
  const editing = computed(() => (editingId.value ? items.byId(editingId.value) : undefined))

  // The card stays while the list is used beside it, so opening the form for
  // something else just switches it.
  function rememberOpener() {
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) opener = active
  }

  // Opens the form card and moves the focus into it. Its content is inert
  // while collapsed, so a card that was collapsed gets the focus after the
  // next render.
  async function showForm() {
    const wasCollapsed = !formExpanded.value
    expanded.value = 'form'
    if (wasCollapsed) await nextTick()
    card.value?.focusName()
  }

  function startEdit(item: Item) {
    rememberOpener()
    newItemOpen.value = false
    if (editingId.value === item.id) {
      void showForm()
      return
    }
    expanded.value = 'form'
    editingName = item.name
    editingId.value = item.id
  }

  // In the card, pressing "new item" while it already shows the form for a new
  // item and nothing was typed in the quick-add bar only moves the focus into
  // it: what was typed in the card stays. Otherwise the form starts afresh.
  function openNew(name: string) {
    rememberOpener()
    if (columnMode.value && editingId.value === null && name === '') {
      newItemOpen.value = true
      void showForm()
      return
    }
    expanded.value = 'form'
    editingId.value = null
    newItemName.value = name
    newItemKey.value++
    newItemOpen.value = true
  }

  // In the card the focus goes back to where the form was opened from, if
  // that is still there (a deleted item takes its row along).
  async function close() {
    newItemOpen.value = false
    editingId.value = null
    newItemKey.value++
    expanded.value = 'overview'
    if (!columnMode.value) return
    const target = opener
    opener = null
    await nextTick()
    if (target?.isConnected) target.focus()
    else if (hasOverview()) overviewCard.value?.focusStart()
  }

  // The bar of the collapsed form card, or the collapse button of the
  // overview card. Neither resets the form: what was typed stays.
  function expandForm() {
    void showForm()
  }

  // The bar of the collapsed overview card, or the collapse button of the form
  // card.
  async function expandOverview() {
    expanded.value = 'overview'
    await nextTick()
    overviewCard.value?.focusStart()
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
      newItemKey.value++
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
    columnMode,
    card,
    overviewCard,
    expanded,
    formExpanded,
    newItemOpen,
    newItemName,
    newItemKey,
    editingId,
    editing,
    startEdit,
    openNew,
    close,
    removeEditing,
    expandForm,
    expandOverview,
  }
}

export type ItemFormControl = ReturnType<typeof createItemFormControl>

// An InjectionKey is a unique Symbol that carries the type, so inject()
// returns an ItemFormControl and not `unknown`.
const ITEM_FORM_CONTROL: InjectionKey<ItemFormControl> = Symbol('itemFormControl')

/** Creates the control and hands it to all components below the caller. */
export function provideItemFormControl(
  list: () => List | undefined,
  hasOverview: () => boolean,
): ItemFormControl {
  const control = createItemFormControl(list, hasOverview)
  provide(ITEM_FORM_CONTROL, control)
  return control
}

/** The control of the surrounding list view. */
export function useItemFormControl(): ItemFormControl {
  const control = inject(ITEM_FORM_CONTROL)
  if (!control) throw new Error('useItemFormControl() needs provideItemFormControl() in a parent')
  return control
}
