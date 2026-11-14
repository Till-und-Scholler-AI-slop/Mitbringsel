<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'
import ItemRow from '@/components/list/ItemRow.vue'
import type { Item } from '@/types/api'

type Person = { name: string; avatarUrl: string | null }

// The checked items of a list, below the open ones (design
// "markt2-erledigt-entfernen"). The head folds the items away and offers
// "Remove", which stays in reach while they are folded.
defineProps<{
  items: Item[]
  personOf: (item: Item) => Person | null
}>()
const emit = defineEmits<{
  toggle: [item: Item]
  // fromKeyboard: started with Enter or Space, so the focus should move on
  // to "Undo" in the toast.
  remove: [fromKeyboard: boolean]
}>()

const { t } = useI18n()
const open = ref(true)

// A click from Enter or Space has no pointer behind it, so the browser
// counts no clicks: detail is 0.
function onRemove(event: MouseEvent) {
  emit('remove', event.detail === 0)
}
</script>

<template>
  <section class="done" :aria-label="t('list.done.title', { count: items.length })">
    <div class="head">
      <button
        type="button"
        class="done-toggle"
        :aria-expanded="open"
        aria-controls="done-items"
        @click="open = !open"
      >
        <BaseIcon :name="open ? 'chevronUp' : 'chevronDown'" :size="20" />
        {{ t('list.done.title', { count: items.length }) }}
      </button>
      <span class="divider" aria-hidden="true"></span>
      <button
        type="button"
        class="remove press-inset"
        :aria-label="t('list.done.removeLabel', { count: items.length })"
        :title="t('list.done.removeHint')"
        @click="onRemove"
      >
        <BaseIcon name="trash" :size="16" />
        <!-- The phone has room for one word only; the desktop spells it out. -->
        <span class="remove-short" aria-hidden="true">{{ t('list.done.remove') }}</span>
        <span class="remove-long" aria-hidden="true">{{ t('list.done.removeLong') }}</span>
      </button>
    </div>
    <ul v-show="open" id="done-items" class="done-items">
      <ItemRow
        v-for="item in items"
        :key="item.id"
        :item="item"
        :person="personOf(item)"
        @toggle="emit('toggle', item)"
      />
    </ul>
  </section>
</template>

<style scoped>
.done {
  padding: var(--space-1) 0 var(--space-2);
  border: var(--border-width-sm) solid var(--color-done-border);
  border-radius: var(--radius-lg);
  background: var(--color-done-bg);
}

/* Fold on the left over the whole rest of the width, "Remove" on the far
   right; the gap with the line in between belongs to neither button. */
.head {
  display: flex;
  align-items: center;
  min-height: 3.25rem;
  padding: 0 var(--space-1) 0 2px;
}

.done-toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  min-height: var(--size-touch);
  padding: 0 var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-heavy);
  text-align: left;
  white-space: nowrap;
  cursor: pointer;
}

.divider {
  flex: none;
  width: 2px;
  height: var(--space-7);
  margin: 0 9px;
  border-radius: 2px;
  background: var(--color-done-divider);
}

/* Danger red on a pale surface, so it reads apart from the fold. */
.remove {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1-5);
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding: 0 var(--space-3) 0 10px;
  box-sizing: border-box;
  border: var(--border-width-sm) solid var(--color-danger);
  border-radius: var(--radius-full);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
  white-space: nowrap;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

@media (hover: hover) {
  .remove:hover {
    background: var(--color-danger-surface-hover);
  }
}

/* Sinks into the section as it is pressed (press-inset), darker. */
.remove:active {
  background: var(--color-danger-surface-pressed);
}

.remove-long {
  display: none;
}

.done-items {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (min-width: 48rem) {
  .head {
    padding: 0 var(--space-2) 0 var(--space-1);
  }

  .done-toggle {
    min-height: 2.75rem;
    padding: 0 10px;
  }

  .divider {
    margin: 0 var(--space-3);
  }

  .remove {
    gap: var(--space-2);
    padding: 0 var(--space-4) 0 14px;
  }

  .remove-short {
    display: none;
  }

  .remove-long {
    display: inline;
  }
}
</style>
