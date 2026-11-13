<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'
import { useErrorText } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { useItemsStore } from '@/stores/items'
import { useToastsStore } from '@/stores/toasts'

// The longest item name the API takes (api/openapi.yaml, CreateItemRequest).
const MAX_NAME_LENGTH = 100

// Adds an item with just its name: type, Enter, type the next one (design
// "markt2-liste", "markt2-desktop"). On the phone the bar sits at the bottom,
// near the thumb; the page places it.
const props = defineProps<{ listId: string }>()

const { t } = useI18n()
const errorText = useErrorText()
const items = useItemsStore()
const toasts = useToastsStore()
const name = ref('')

// The field empties at once, so the next item can be typed while this one
// is on its way; a slow shop network should not hold the user up. The item
// shows when the server answers.
async function add() {
  const trimmed = name.value.trim()
  if (!trimmed) return
  name.value = ''
  try {
    await items.create(props.listId, { name: trimmed })
  } catch (err) {
    // Nothing is lost: the name goes back, unless the user typed on.
    if (!name.value) name.value = trimmed
    toasts.show({
      kind: 'error',
      text: t('list.quickAdd.failed', { name: trimmed }),
      detail: errorText(err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN),
    })
  }
}
</script>

<template>
  <!-- A form, so Enter (and the Enter key of a phone keyboard) adds, and
       the browser leaves Enter alone while an input method composes text. -->
  <form class="quick-add" @submit.prevent="add">
    <!-- The whole pill focuses the field. -->
    <label class="field">
      <BaseIcon name="plus" :size="22" />
      <input
        v-model="name"
        type="text"
        :aria-label="t('list.quickAdd.label')"
        :placeholder="t('list.quickAdd.placeholder')"
        :maxlength="MAX_NAME_LENGTH"
        enterkeyhint="done"
        autocomplete="off"
      />
      <span class="hint" aria-hidden="true">{{ t('list.quickAdd.enterHint') }}</span>
    </label>
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

/* A keyboard hint only makes sense with a keyboard. */
.hint {
  display: none;
}

@media (min-width: 48rem) {
  .quick-add {
    gap: var(--space-3);
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
</style>
