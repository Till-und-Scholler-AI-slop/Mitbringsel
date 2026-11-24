<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'
import { useItemsStore } from '@/stores/items'

// The longest item name the API takes (api/openapi.yaml, CreateItemRequest).
const MAX_NAME_LENGTH = 100

// Adds an item with just its name: type, Enter, type the next one (design
// "markt2-liste", "markt2-desktop"). On the phone the bar sits at the bottom,
// near the thumb; the page places it.
// "With details" hands what was typed so far to the item form; opensDialog
// is false when that form is a card next to the list; there the button shows
// with `pressed` whether the card offers a new item. Without `pressed` it is
// no toggle and gets no aria-pressed.
// compact: the bar of the pinned list in the context column: only the pill,
// without the details button and the Enter hint. label: what the field is
// called for screen readers, e.g. "Add item to Bakery" there.
const props = withDefaults(
  defineProps<{
    listId: string
    opensDialog?: boolean
    pressed?: boolean
    compact?: boolean
    label?: string
  }>(),
  { opensDialog: true, pressed: undefined, compact: false, label: undefined },
)
const emit = defineEmits<{ details: [name: string] }>()

const { t } = useI18n()
const items = useItemsStore()
const name = ref('')

// The field empties at once, so the next item can be typed while this one
// is on its way; the item shows at once.
function openDetails() {
  emit('details', name.value.trim())
  name.value = ''
}

const detailsLabel = computed(() =>
  t(props.opensDialog ? 'list.quickAdd.details' : 'list.quickAdd.detailsCard'),
)

function add() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  name.value = ''
  void items.create(props.listId, { name: trimmed })
}
</script>

<template>
  <!-- A form, so Enter (and the Enter key of a phone keyboard) adds, and
       the browser leaves Enter alone while an input method composes text. -->
  <form :class="['quick-add', { 'quick-add--compact': compact }]" @submit.prevent="add">
    <!-- The whole pill focuses the field. -->
    <label class="field">
      <BaseIcon name="plus" :size="compact ? 18 : 22" />
      <input
        v-model="name"
        type="text"
        :aria-label="label ?? t('list.quickAdd.label')"
        :placeholder="t('list.quickAdd.placeholder')"
        :maxlength="MAX_NAME_LENGTH"
        enterkeyhint="done"
        autocomplete="off"
      />
      <span v-if="!compact" class="hint" aria-hidden="true">{{
        t('list.quickAdd.enterHint')
      }}</span>
    </label>
    <button
      v-if="!compact"
      type="button"
      class="details press-sticker"
      :aria-label="detailsLabel"
      :title="detailsLabel"
      :aria-haspopup="opensDialog ? 'dialog' : undefined"
      :aria-pressed="pressed"
      @click="openDetails"
    >
      <BaseIcon name="sliders" :size="22" />
    </button>
  </form>
</template>

<style scoped>
.quick-add {
  display: flex;
  align-items: center;
  gap: 10px;
}

.field {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--size-quick-add);
  padding: 0 18px;
  box-sizing: border-box;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: text;
}

/* The pill shows the focus, with a gap in the page color. */
.field:focus-within {
  box-shadow:
    0 0 0 3px var(--color-bg),
    0 0 0 6px var(--color-focus);
}

input {
  flex: 1;
  min-width: 0;
  height: 2.75rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 1.0625rem;
  font-weight: var(--font-weight-semibold);
}

input:focus-visible {
  outline: none;
}

input::placeholder {
  color: var(--color-text-muted);
}

/* Round, in the sticker look of a primary button (press-sticker). */
.details {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--size-quick-add);
  height: var(--size-quick-add);
  box-sizing: border-box;
  border: var(--border-width-md) solid var(--color-primary-contrast);
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-primary-contrast);
  box-shadow: var(--shadow-sticker);
  cursor: pointer;
}

/* A keyboard hint only makes sense with a keyboard. */
.hint {
  display: none;
}

@media (min-width: 48rem) {
  .quick-add {
    gap: var(--space-3);
  }

  .details {
    width: var(--size-quick-add-desktop);
    height: var(--size-quick-add-desktop);
  }

  .field {
    gap: 10px;
    min-height: var(--size-quick-add-desktop);
    padding: 0 var(--space-3) 0 var(--space-5);
  }

  input {
    font-size: var(--font-size-lg);
  }

  .hint {
    display: inline;
    flex: none;
    padding: var(--space-1) 10px;
    border-radius: 10px;
    background: var(--color-bg);
    color: var(--color-text-muted);
    font-size: 0.8125rem;
    font-weight: var(--font-weight-heavy);
  }
}

/* Large screens: the icon as large as in the design (80rem:
   CONTEXT_COLUMN_QUERY in contextColumn.ts). */
@media (min-width: 80rem) {
  .details :deep(svg) {
    width: 1.5rem;
    height: 1.5rem;
  }
}

/* The pinned list: a smaller pill. After the media queries, so it wins at
   every width. */
.quick-add--compact {
  gap: var(--space-2);
}

.quick-add--compact .field {
  gap: var(--space-2);
  min-height: 3.25rem;
  padding: 0 var(--space-3) 0 var(--space-4);
  border-width: var(--border-width-sm);
}

.quick-add--compact input {
  height: 2.5rem;
  font-size: var(--font-size-md);
}
</style>
