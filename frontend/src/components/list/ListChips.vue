<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import BaseIcon from '@/components/base/BaseIcon.vue'
import { useLongPress } from '@/composables/useLongPress'
import type { List } from '@/types/api'

// The lists of a household as chips in the green bar; the current one looks
// pressed in and shows how many items are still open.
//
// The actions of a list (rename, archive, delete) open with a long press or
// right click on its chip, or by choosing the current chip again; the last
// one is the way for keyboards and screen readers.
//
// lists: the active lists. currentArchived: the open list is archived and so
// not among them; the archive chip looks pressed in instead.
const props = defineProps<{
  groupId: string
  lists: List[]
  currentId: string
  openCount: number
  archivedCount: number
  currentArchived: boolean
}>()
const emit = defineEmits<{ create: []; actions: [list: List]; archive: [] }>()

const { t } = useI18n()
const hintId = useId()
const press = useLongPress<List>((list) => emit('actions', list))

// navigate: the RouterLink's own handler, called only for a plain choice of
// another list.
function onClick(event: MouseEvent, list: List, navigate: (e: MouseEvent) => unknown) {
  if (press.consumeClick(event)) {
    event.preventDefault()
    return
  }
  if (list.id === props.currentId) {
    event.preventDefault()
    emit('actions', list)
    return
  }
  navigate(event)
}
</script>

<template>
  <nav class="chips" :aria-label="t('list.chips')">
    <!-- custom: the link is our own <a>, so a long press can stop the
         navigation before the router sees the click. -->
    <RouterLink
      v-for="list in lists"
      :key="list.id"
      v-slot="{ href, navigate }"
      :to="{ name: 'list', params: { groupId, listId: list.id } }"
      custom
    >
      <a
        :href="href"
        :class="['chip', { 'chip--current': list.id === currentId }]"
        :aria-current="list.id === currentId ? 'page' : undefined"
        :aria-describedby="list.id === currentId ? hintId : undefined"
        v-on="press.handlers(list)"
        @click="onClick($event, list, navigate)"
      >
        <span class="chip-name">{{ list.name }}</span>
        <span v-if="list.id === currentId && openCount > 0" class="count">{{ openCount }}</span>
      </a>
    </RouterLink>
    <button
      v-if="archivedCount > 0"
      type="button"
      :class="['chip', 'chip--archive', { 'chip--current': currentArchived }]"
      aria-haspopup="dialog"
      @click="$emit('archive')"
    >
      <BaseIcon name="archive" :size="18" />
      {{ t('list.archive.chip', { count: archivedCount }) }}
    </button>
    <button type="button" class="add" :aria-label="t('list.newList')" @click="$emit('create')">
      <BaseIcon name="plus" :size="20" :stroke-width="2.5" />
    </button>
    <span :id="hintId" class="sr-only">{{ t('list.chipHint') }}</span>
  </nav>
</template>

<style scoped>
.chips {
  display: flex;
  gap: var(--space-2);
  margin: var(--space-1) calc(-1 * var(--space-4)) 0;
  padding: var(--space-1-5) var(--space-4) var(--space-1);
  overflow-x: auto;
  scrollbar-width: none;
}

.chips::-webkit-scrollbar {
  display: none;
}

.chip {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--size-touch);
  padding: 0 var(--space-4);
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  box-shadow: var(--shadow-sticker);
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-heavy);
  text-decoration: none;
  cursor: pointer;
  /* No link preview or text selection while a finger is held on a chip. */
  -webkit-touch-callout: none;
  user-select: none;
  transition:
    transform var(--duration-press) var(--easing-bounce),
    box-shadow var(--duration-press) var(--easing-bounce);
}

/* Pressed in = the list that is open. */
.chip--current {
  background: var(--color-primary);
  color: var(--color-primary-contrast);
  box-shadow: none;
  transform: translateY(3px);
}

.chip-name {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  display: grid;
  place-items: center;
  min-width: 1.375rem;
  height: 1.375rem;
  padding: 0 var(--space-1-5);
  border-radius: var(--radius-full);
  background: var(--color-selected-bg);
  color: var(--color-primary);
  font-size: 0.75rem;
  font-weight: var(--font-weight-heavy);
}

.add {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--size-touch);
  height: var(--size-touch);
  border: var(--border-width-sm) dashed var(--color-on-brand);
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-on-brand);
  cursor: pointer;
}

@media (prefers-reduced-motion: reduce) {
  .chip {
    transition: none;
  }
}
</style>
