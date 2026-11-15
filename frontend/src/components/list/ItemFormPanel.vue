<script setup lang="ts">
import { onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIconButton from '@/components/base/BaseIconButton.vue'
import ItemForm from '@/components/list/ItemForm.vue'
import type { Item } from '@/types/api'

// The item form as a panel next to the list (design "markt2-desktop"). Not
// modal: the list stays usable beside it, so the panel takes care of what
// <dialog> would do itself (focus on open, Escape). Props as ItemFormDialog.
defineProps<{
  listId: string
  listName: string
  initialName?: string
  item?: Item
  creatorName?: string | null
}>()
// fromKeyboard: Delete was pressed with Enter or Space (see DoneSection).
const emit = defineEmits<{ close: []; remove: [fromKeyboard: boolean] }>()

const { t } = useI18n()
const titleId = useId()
const panel = ref<HTMLElement | null>(null)

// The name field is the first input of the form.
function focusName() {
  panel.value?.querySelector('input')?.focus()
}

onMounted(focusName)
defineExpose({ focusName })
</script>

<template>
  <aside ref="panel" class="panel" :aria-labelledby="titleId" @keydown.esc="emit('close')">
    <header class="header">
      <h2 :id="titleId" class="title">
        {{ item ? t('list.itemForm.editTitle') : t('list.itemForm.newTitle') }}
      </h2>
      <BaseIconButton icon="close" :label="t('common.close')" @click="emit('close')" />
    </header>
    <ItemForm
      :list-id="listId"
      :list-name="listName"
      :initial-name="initialName"
      :item="item"
      :creator-name="creatorName"
      @close="emit('close')"
      @remove="emit('remove', $event)"
    />
  </aside>
</template>

<style scoped>
/* A column next to the list in ListView's flex row. It stays in view while
   the list scrolls and scrolls itself if the window is too low. */
.panel {
  flex: 1 1 22.5rem;
  position: sticky;
  top: var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  max-height: calc(100dvh - 2 * var(--space-4));
  overflow-y: auto;
  margin: var(--space-4);
  padding: var(--space-5) var(--space-5) 1.375rem;
  border: var(--border-width-lg) solid var(--color-panel-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface);
  color: var(--color-text);
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.title {
  min-width: 0;
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-heading);
  letter-spacing: -0.02em;
  overflow-wrap: break-word;
}
</style>
