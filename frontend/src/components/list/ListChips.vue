<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSticker from '@/components/base/BaseSticker.vue'
import { useLongPress } from '@/composables/useLongPress'
import type { List } from '@/types/api'

// The lists of a household as chips in the green bar, each with the sticker
// of its icon; the current one looks pressed in and shows how many items are
// still open.
//
// The actions of a list (rename, archive, delete) open with a long press or
// right click on its chip, or by choosing the current chip again; the last
// one is the way for keyboards and screen readers.
//
// The chips are buttons, not links: a held link makes mobile browsers show
// their own menu (open in new tab, share) on top of ours.
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
const router = useRouter()
const hintId = useId()
const press = useLongPress<List>((list) => emit('actions', list))

function onClick(list: List) {
  if (list.id === props.currentId) {
    emit('actions', list)
    return
  }
  router.push({ name: 'list', params: { groupId: props.groupId, listId: list.id } })
}
</script>

<template>
  <nav class="chips" :aria-label="t('list.chips')">
    <button
      v-for="list in lists"
      :key="list.id"
      type="button"
      :class="['chip', 'chip--list', 'press-sticker', { 'chip--current': list.id === currentId }]"
      :aria-current="list.id === currentId ? 'page' : undefined"
      :aria-describedby="list.id === currentId ? hintId : undefined"
      v-on="press.handlers(list)"
      @click="onClick(list)"
    >
      <BaseSticker :icon="list.icon" />
      <span class="chip-name">{{ list.name }}</span>
      <span v-if="list.id === currentId && openCount > 0" class="count">{{ openCount }}</span>
    </button>
    <button
      v-if="archivedCount > 0"
      type="button"
      :class="['chip', 'chip--archive', 'press-sticker', { 'chip--current': currentArchived }]"
      aria-haspopup="dialog"
      @click="$emit('archive')"
    >
      <BaseIcon name="archive" :size="18" />
      {{ t('list.archive.chip', { count: archivedCount }) }}
    </button>
    <button
      type="button"
      class="add press-inset"
      :aria-label="t('list.newList')"
      @click="$emit('create')"
    >
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
  min-height: 3.25rem;
  padding: 0 var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  box-shadow: var(--shadow-sticker);
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-heavy);
  text-decoration: none;
  cursor: pointer;
  /* No text selection or callout while a finger is held on a chip. */
  -webkit-touch-callout: none;
  user-select: none;
}

/* The sticker sits close to the left edge, like on a real chip. */
.chip--list {
  padding-left: 2px;
}

/* Pressed in = the list that is open. Ink border in both themes: it sits on
   tomato, not on the page. */
.chip--current {
  border-color: var(--color-on-accent);
  background: var(--color-primary);
  color: var(--color-primary-contrast);
  box-shadow: inset 0 3px 0 color-mix(in srgb, var(--color-on-accent) 20%, transparent);
  transform: translateY(3px);
}

.chip--list.chip--current {
  padding-right: var(--space-3);
}

.chip-name {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Ink with white in both themes, like the border of the current chip. */
.count {
  display: grid;
  place-items: center;
  min-width: 1.625rem;
  height: 1.5rem;
  padding: 0 0.4375rem;
  border-radius: var(--radius-full);
  background: var(--color-on-accent);
  color: var(--color-accent-white);
  font-size: 0.8125rem;
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

/* Desktop: there is room, so the chips wrap instead of scrolling, and the
   plus sits on the page instead of the green header. */
@media (min-width: 48rem) {
  .chips {
    flex-wrap: wrap;
    gap: 0.625rem;
    margin: 0;
    padding: 2px 0 var(--space-1);
    overflow-x: visible;
  }

  .add {
    width: 3.125rem;
    height: 3.125rem;
    border-color: var(--color-text);
    color: var(--color-text);
  }
}
</style>
