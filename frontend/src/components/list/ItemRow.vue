<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import { useQuantityText } from '@/composables/useQuantityText'
import type { Item } from '@/types/api'

const AVATAR_SIZE = 26
const AVATAR_SIZE_DONE = 22

// person: who added the item (open) or checked it (done); null if that
// person left the household or deleted their account.
// recent: another member just changed the item; name is null if that member
// is not (yet) among the known members. Only open items show it.
const props = withDefaults(
  defineProps<{
    item: Item
    person: { name: string; avatarUrl: string | null } | null
    recent?: { name: string | null } | null
  }>(),
  { recent: null },
)
// edit: only open items offer it (design "markt2-liste"); a done item comes
// back with a tap first.
defineEmits<{ toggle: []; edit: [] }>()

const { t } = useI18n()
const quantityText = useQuantityText()

const quantity = computed(() => quantityText(props.item))
const done = computed(() => props.item.checked)
// Only open items show a recent change.
const recentShown = computed(() => props.recent !== null && !done.value)
const recentName = computed(() => (recentShown.value ? (props.recent?.name ?? null) : null))

// What a screen reader says: the whole row is one button, so everything the
// eye sees on it has to be in the label.
const label = computed(() => {
  const details = [props.item.name, quantity.value, done.value ? null : props.item.note]
  const by = props.person
    ? t(done.value ? 'list.row.checkedBy' : 'list.row.addedBy', { name: props.person.name })
    : null
  const recent = recentShown.value
    ? recentName.value
      ? t('list.row.justChangedBy', { name: recentName.value })
      : t('list.row.justChangedByAnon')
    : null
  const action = t(done.value ? 'list.row.uncheck' : 'list.row.check')
  return `${[...details, by, recent].filter(Boolean).join(', ')} – ${action}`
})
</script>

<template>
  <li :class="['row', { 'row--done': done, 'row--recent': recentShown }]">
    <button type="button" class="toggle" :aria-label="label" @click="$emit('toggle')">
      <span class="box" aria-hidden="true">
        <BaseIcon v-if="done" name="check" :size="16" :stroke-width="3.5" />
      </span>
      <span class="text">
        <span class="name" lang="de">{{ item.name }}</span>
        <span v-if="item.note && !done" class="note">{{ item.note }}</span>
        <!-- Only the name gets cut off when it is too long, so "just changed"
           always stays visible; the title shows the whole text. -->
        <i18n-t
          v-if="recentName"
          keypath="list.row.justChanged"
          tag="span"
          class="recent"
          :title="t('list.row.justChanged', { name: recentName })"
        >
          <template #name>
            <span class="recent-name">{{ recentName }}</span>
          </template>
        </i18n-t>
        <span v-else-if="recentShown" class="recent">{{ t('list.row.justChangedAnon') }}</span>
      </span>
      <span v-if="quantity" class="quantity">{{ quantity }}</span>
      <BaseAvatar
        v-if="person"
        :name="person.name"
        :src="person.avatarUrl"
        :size="done ? AVATAR_SIZE_DONE : AVATAR_SIZE"
      />
    </button>
    <button
      v-if="!done"
      type="button"
      class="edit"
      :aria-label="t('list.row.edit', { name: item.name })"
      :title="t('list.row.editHint')"
      aria-haspopup="dialog"
      @click="$emit('edit')"
    >
      <!-- The phone shows dots, the desktop a pencil (design). -->
      <BaseIcon class="edit-phone" name="ellipsis" :size="22" />
      <BaseIcon class="edit-desktop" name="pencil" :size="20" />
    </button>
  </li>
</template>

<style scoped>
.row {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: var(--radius-md);
  background: var(--color-surface);
  /* The highlight of a recent change fades out instead of vanishing. */
  transition:
    background-color 0.4s ease-out,
    box-shadow 0.4s ease-out,
    margin 0.4s ease-out;
}

/* Another member just changed it: lifted out of the list with a ring. */
.row--recent {
  z-index: 1;
  margin-block: var(--space-1-5);
  background: var(--color-recent-bg);
  box-shadow: var(--shadow-recent);
}

@media (prefers-reduced-motion: reduce) {
  .row {
    transition: none;
  }
}

.row--done {
  background: transparent;
}

.toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 3.625rem;
  /* Design "markt2-liste": tight on the right, where the edit button follows. */
  padding: 10px var(--space-1) 10px 14px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.edit {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  margin-right: var(--space-1-5);
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
}

@media (hover: hover) {
  .edit:hover {
    background: var(--color-bg);
  }
}

.edit-desktop {
  display: none;
}

@media (min-width: 48rem) {
  .edit {
    margin-right: var(--space-2);
  }

  .edit-phone {
    display: none;
  }

  .edit-desktop {
    display: block;
  }
}

.row--done .toggle {
  min-height: var(--size-touch);
  padding: var(--space-1) 14px;
}

.box {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.row--done .box {
  border-color: var(--color-success);
  background: var(--color-success);
  color: var(--color-on-brand);
}

.text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
}

.name {
  min-width: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  line-height: 1.3;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
  hyphens: auto;
}

.row--done .name {
  color: var(--color-done-text);
  font-size: 1.0625rem;
  line-height: 1.375rem;
  font-weight: var(--font-weight-semibold);
  text-decoration: line-through;
  text-decoration-thickness: 2px;
}

.note {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

/* A flex row, so the name alone can shrink; pre keeps the spaces around
   the name, which a flex item would drop at its edges. */
.recent {
  display: flex;
  max-width: 100%;
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-accent-tomato);
  color: var(--color-on-accent);
  font-size: 0.75rem;
  line-height: 1rem;
  font-weight: var(--font-weight-heavy);
  white-space: pre;
}

.recent-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quantity {
  flex: none;
  padding: 3px 10px;
  border: var(--border-width-sm) solid var(--color-qty-border);
  border-radius: var(--radius-full);
  background: var(--color-qty-bg);
  color: var(--color-qty-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
  line-height: 1.125rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.row--done .quantity {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-done-text);
  font-weight: var(--font-weight-bold);
}
</style>
