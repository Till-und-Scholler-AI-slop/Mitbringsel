<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'
import ItemRowBody from '@/components/list/ItemRowBody.vue'
import { useQuantityText } from '@/composables/useQuantityText'
import type { Item } from '@/types/api'

const AVATAR_SIZE = 26
const AVATAR_SIZE_DONE = 22
const AVATAR_SIZE_SELECTABLE = 28

// person: who added the item (open) or checked it (done); null if that
// person left the household or deleted their account.
// recent: another member just changed the item; name is null if that member
// is not (yet) among the known members. Only open items show it.
// editing: its form is open in the card next to the list (large screens).
// pending: this item has an unsynced change in the outbox (shown on open items).
// opensDialog: false when the edit button opens that card, not a dialog.
// selectable: the list column on a large screen. The checkbox is a button of
// its own that checks the item off, and the rest of the row opens its form
// in the card (design "markt2-kontext-*"). Otherwise the row checks off and a
// pencil or dots button opens the form.
const props = withDefaults(
  defineProps<{
    item: Item
    person: { name: string; avatarUrl: string | null } | null
    recent?: { name: string | null } | null
    editing?: boolean
    pending?: boolean
    opensDialog?: boolean
    selectable?: boolean
  }>(),
  { recent: null, editing: false, pending: false, opensDialog: true, selectable: false },
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
const editingShown = computed(() => props.editing && !done.value)
const pendingShown = computed(() => props.pending && !done.value)
// A done item comes back with a tap first, so it keeps the plain row.
const selectableShown = computed(() => props.selectable && !done.value)
const avatarSize = computed(() => {
  if (selectableShown.value) return AVATAR_SIZE_SELECTABLE
  return done.value ? AVATAR_SIZE_DONE : AVATAR_SIZE
})

// What a screen reader says: everything the eye sees on the row has to be in
// the label of its button.
const details = computed(() => {
  const parts = [props.item.name, quantity.value, done.value ? null : props.item.note]
  const by = props.person
    ? t(done.value ? 'list.row.checkedBy' : 'list.row.addedBy', { name: props.person.name })
    : null
  const recent = recentShown.value
    ? recentName.value
      ? t('list.row.justChangedBy', { name: recentName.value })
      : t('list.row.justChangedByAnon')
    : null
  const editing = editingShown.value ? t('list.row.editingLabel') : null
  const pending = pendingShown.value ? t('list.row.pendingLabel') : null
  return [...parts, by, recent, editing, pending].filter(Boolean).join(', ')
})
const label = computed(
  () => `${details.value} – ${t(done.value ? 'list.row.uncheck' : 'list.row.check')}`,
)
const openLabel = computed(() => t('list.row.openLabel', { details: details.value }))
</script>

<template>
  <li
    :class="[
      'row',
      {
        'row--done': done,
        'row--recent': recentShown,
        'row--editing': editingShown,
        'row--selectable': selectableShown,
      },
    ]"
  >
    <template v-if="selectableShown">
      <button
        type="button"
        class="check"
        :aria-label="t('list.row.checkItem', { name: item.name })"
        @click="$emit('toggle')"
      >
        <span class="box" aria-hidden="true" />
      </button>
      <button type="button" class="open" :aria-label="openLabel" @click="$emit('edit')">
        <ItemRowBody
          :item="item"
          :quantity="quantity"
          :person="person"
          :recent-name="recentName"
          :recent-shown="recentShown"
          :pending="pendingShown"
          :done="done"
          :avatar-size="avatarSize"
        />
        <BaseIcon class="chevron" name="chevronRight" :size="20" :stroke-width="2.5" />
      </button>
    </template>
    <template v-else>
      <button type="button" class="toggle" :aria-label="label" @click="$emit('toggle')">
        <span class="box" aria-hidden="true">
          <BaseIcon v-if="done" name="check" :size="16" :stroke-width="3.5" />
        </span>
        <ItemRowBody
          :item="item"
          :quantity="quantity"
          :person="person"
          :recent-name="recentName"
          :recent-shown="recentShown"
          :pending="pendingShown"
          :done="done"
          :avatar-size="avatarSize"
        />
      </button>
      <button
        v-if="!done"
        type="button"
        class="edit"
        :aria-label="t('list.row.edit', { name: item.name })"
        :title="t('list.row.editHint')"
        :aria-haspopup="opensDialog ? 'dialog' : undefined"
        @click="$emit('edit')"
      >
        <!-- The phone shows dots, the desktop a pencil (design). -->
        <BaseIcon class="edit-phone" name="ellipsis" :size="22" />
        <BaseIcon class="edit-desktop" name="pencil" :size="20" />
      </button>
    </template>
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

/* Its form is open in the card: light background and an orange ring that
   fills the gap between the rows. A recent change of someone else wins, as
   in the design. */
.row--editing:not(.row--recent) {
  z-index: 1;
  background: var(--color-row-selected-bg);
  box-shadow: var(--shadow-row-selected);
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

/* The list column on a large screen: the checkbox and the rest of the row are
   two buttons. */
.row--selectable {
  min-height: 3.875rem;
  padding: 0 var(--space-2);
}

/* The box is 28px; the button around it is the 44px hit area. */
.check {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  cursor: pointer;
}

.open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 3.625rem;
  padding: var(--space-1-5) var(--space-1) var(--space-1-5) var(--space-2);
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.chevron {
  flex: none;
  color: var(--color-text-muted);
}

/* The focus is drawn inside the row, so it never sits on the orange ring. */
.open:focus-visible {
  outline-offset: calc(-1 * var(--border-width-lg));
}

@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .open {
    transition: transform var(--duration-lift) ease;
  }

  .open:hover {
    transform: translateY(-1px);
  }
}
</style>
