import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { useErrorText } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { isItemNoteTooLong, parseQuantity, validateItemName } from '@/services/itemForm'
import { useItemsStore } from '@/stores/items'
import type { Item, Unit, UpdateItemRequest } from '@/types/api'

// A new item starts with this unit picked, as in the design; so does an
// item without a unit, in case the user adds a quantity.
const DEFAULT_UNIT: Unit = 'piece'
// More digits than this are noise (as in useQuantityText).
const MAX_FRACTION_DIGITS = 3

// Errors of the server that belong to one field; any other is shown above
// the buttons.
const FIELD_ERRORS = {
  name: 'ITEM_NAME_INVALID',
  quantity: 'ITEM_QUANTITY_INVALID',
  note: 'ITEM_NOTE_INVALID',
} as const

type Fields = { name: string; quantity: string; unit: Unit | null; note: string }

export interface UseItemFormOptions {
  /** Whether the form is visible; opening resets the fields. */
  open: () => boolean
  listId: () => string
  initialName?: () => string | undefined
  item?: () => Item | undefined
}

/**
 * State, validation, per-field LWW diff, and submission for creating or
 * editing a shopping list item. Every opening starts afresh from the current
 * item or initialName; later updates to the item by other members do not
 * overwrite unsaved input.
 */
export function useItemForm(options: UseItemFormOptions) {
  const { t, n } = useI18n()
  const errorText = useErrorText()
  const items = useItemsStore()

  const name = ref('')
  const quantity = ref('')
  const unit = ref<Unit | null>(DEFAULT_UNIT)
  const note = ref('')
  // An empty name is only an error once the user tried to save.
  const tried = ref(false)
  const submitting = ref(false)
  // The error code of the last failed request; null while there is none.
  const errorCode = ref<string | null>(null)

  // The fields as they were filled at the opening. Saving an edit sends only
  // what the user changed from them: a field another member changes meanwhile
  // keeps their value (last writer wins per field, docs/adr/0004).
  let opened: Fields = { name: '', quantity: '', unit: DEFAULT_UNIT, note: '' }

  function fieldsOf(item: Item | undefined): Fields {
    if (!item) {
      return { name: options.initialName?.() ?? '', quantity: '', unit: DEFAULT_UNIT, note: '' }
    }
    return {
      name: item.name,
      quantity:
        item.quantity === null
          ? ''
          : n(item.quantity, { maximumFractionDigits: MAX_FRACTION_DIGITS, useGrouping: false }),
      unit: item.unit ?? DEFAULT_UNIT,
      note: item.note ?? '',
    }
  }

  // Every opening starts afresh. immediate: the parent may render it open.
  // Later changes of the item by others do not overwrite what is typed.
  watch(
    options.open,
    (isOpen) => {
      if (!isOpen) return
      opened = fieldsOf(options.item?.())
      name.value = opened.name
      quantity.value = opened.quantity
      unit.value = opened.unit
      note.value = opened.note
      tried.value = false
      errorCode.value = null
    },
    { immediate: true },
  )

  // A server error is about what was sent; it goes once the user changes it.
  watch([name, quantity, unit, note], () => {
    errorCode.value = null
  })

  const nameProblem = computed(() => validateItemName(name.value))
  const parsedQuantity = computed(() => parseQuantity(quantity.value))
  const noteTooLong = computed(() => isItemNoteTooLong(note.value))

  const serverError = (field: keyof typeof FIELD_ERRORS) =>
    errorCode.value === FIELD_ERRORS[field] ? errorText(errorCode.value) : null

  // "Too long" and a number that does not parse show while typing.
  const nameError = computed(() => {
    if (nameProblem.value === 'tooLong') return errorText(FIELD_ERRORS.name)
    if (nameProblem.value === 'empty' && tried.value) return t('list.itemForm.nameEmpty')
    return serverError('name')
  })
  const quantityError = computed(() => {
    const parsed = parsedQuantity.value
    if (!parsed.ok) {
      return parsed.problem === 'invalid'
        ? t('list.itemForm.quantityInvalid')
        : errorText(FIELD_ERRORS.quantity)
    }
    return serverError('quantity')
  })
  const noteError = computed(() =>
    noteTooLong.value ? errorText(FIELD_ERRORS.note) : serverError('note'),
  )
  const formError = computed(() => {
    const code = errorCode.value
    if (code === null || Object.values<string>(FIELD_ERRORS).includes(code)) return null
    return errorText(code)
  })

  const invalid = computed(
    () => nameProblem.value !== null || !parsedQuantity.value.ok || noteTooLong.value,
  )

  // What changed since the opening. The unit goes with a changed quantity
  // too: a unit without a quantity says nothing (useQuantityText shows none),
  // so clearing the quantity clears the unit as well.
  function changes(quantityValue: number | null): UpdateItemRequest {
    const change: UpdateItemRequest = {}
    const quantityChanged = quantity.value.trim() !== opened.quantity
    if (name.value.trim() !== opened.name) change.name = name.value.trim()
    if (quantityChanged) change.quantity = quantityValue
    if (quantityChanged || unit.value !== opened.unit) {
      change.unit = quantityValue === null ? null : unit.value
    }
    if (note.value.trim() !== opened.note) change.note = note.value.trim() || null
    return change
  }

  async function save(quantityValue: number | null) {
    const current = options.item?.()
    if (current) {
      const change = changes(quantityValue)
      // Nothing changed: no request.
      if (Object.keys(change).length > 0) await items.update(current.id, change)
      return
    }
    await items.create(options.listId(), {
      name: name.value.trim(),
      quantity: quantityValue,
      unit: quantityValue === null ? null : unit.value,
      note: note.value.trim() || null,
    })
  }

  /**
   * Validates and submits the form. Returns true when saving succeeded (or an
   * edit had no changes) so the caller can close the form.
   */
  async function submit(): Promise<boolean> {
    tried.value = true
    const parsed = parsedQuantity.value
    if (invalid.value || !parsed.ok || submitting.value) return false
    submitting.value = true
    try {
      await save(parsed.value)
      return true
    } catch (err) {
      errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
      return false
    } finally {
      submitting.value = false
    }
  }

  return {
    name,
    quantity,
    unit,
    note,
    nameError,
    quantityError,
    noteError,
    formError,
    submitting,
    submit,
  }
}
