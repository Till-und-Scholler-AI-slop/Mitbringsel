<script setup lang="ts">
import { ref, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import BaseIcon from '@/components/base/BaseIcon.vue'
import type { Group } from '@/types/api'

// The household name in the head of the list view; it opens a panel to
// switch to another household, manage this one, found or join one, or go
// back to the start page.
//
// A disclosure, not role="menu": a menu promises arrow-key navigation, the
// panel is plain links and buttons in tab order instead.
const props = defineProps<{ current: Group; groups: Group[] }>()
const emit = defineEmits<{ create: []; join: [] }>()

const { t } = useI18n()
const toggle = useTemplateRef<HTMLButtonElement>('toggle')
const panelId = useId()
const open = ref(false)

function close() {
  open.value = false
}

function onEscape() {
  if (open.value) {
    close()
    toggle.value?.focus()
  }
}

// The dialogs for founding and joining belong to the parent; the panel
// closes first so it is not left open behind them.
function ask(what: 'create' | 'join') {
  close()
  if (what === 'create') emit('create')
  else emit('join')
}

const isCurrent = (group: Group) => group.id === props.current.id
</script>

<template>
  <div class="switcher" @keydown.esc="onEscape">
    <button
      ref="toggle"
      type="button"
      class="toggle"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="open = !open"
    >
      <span class="name">{{ current.name }}</span>
      <BaseIcon :name="open ? 'chevronUp' : 'chevronDown'" :size="24" :stroke-width="2.75" />
    </button>

    <!-- Dims the page and catches the tap next to the panel, so that tap
         closes the panel instead of checking an item behind it. -->
    <div v-if="open" class="scrim" aria-hidden="true" @click="close" />

    <div v-if="open" :id="panelId" class="panel">
      <h2 class="heading">{{ t('list.switcher.title') }}</h2>
      <ul class="groups">
        <li v-for="group in groups" :key="group.id">
          <RouterLink
            :class="['entry', 'group', { 'group--current': isCurrent(group) }]"
            :to="{ name: 'group', params: { groupId: group.id } }"
            :aria-current="isCurrent(group) ? 'page' : undefined"
            @click="close"
          >
            <span class="house" aria-hidden="true"><BaseIcon name="home" :size="18" /></span>
            <span class="group-text">
              <span class="group-name">{{ group.name }}</span>
              <span class="group-members">{{
                t('list.switcher.members', group.members.length)
              }}</span>
            </span>
            <BaseIcon v-if="isCurrent(group)" name="check" :size="22" :stroke-width="3" />
          </RouterLink>
        </li>
      </ul>

      <span class="divider" aria-hidden="true" />

      <RouterLink
        class="entry action"
        :to="{ name: 'group-settings', params: { groupId: current.id } }"
        @click="close"
      >
        <BaseIcon name="settings" :size="20" />
        {{ t('list.switcher.manage') }}
      </RouterLink>
      <button type="button" class="entry action" aria-haspopup="dialog" @click="ask('create')">
        <BaseIcon name="plus" :size="20" />
        {{ t('list.switcher.create') }}
      </button>
      <button type="button" class="entry action" aria-haspopup="dialog" @click="ask('join')">
        <BaseIcon name="link" :size="20" />
        {{ t('list.switcher.join') }}
      </button>
      <RouterLink class="entry action" :to="{ name: 'home' }" @click="close">
        <BaseIcon name="arrowLeft" :size="20" />
        {{ t('list.switcher.start') }}
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.switcher {
  position: relative;
  min-width: 0;
}

.toggle {
  /* Above the scrim, so the name stays readable and closes again. */
  position: relative;
  z-index: 11;
  min-width: 0;
  max-width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-height: var(--size-touch);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  /* White on the green phone header, ink on the desktop page. */
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.name {
  min-width: 0;
  overflow: hidden;
  font-size: 1.6875rem;
  font-weight: var(--font-weight-display);
  line-height: 2rem;
  letter-spacing: -0.025em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toggle :deep(svg) {
  flex: none;
}

.scrim {
  position: fixed;
  inset: 0;
  z-index: 10;
  background: var(--color-scrim);
}

/* As wide as the screen allows, 12px from both edges on a phone. */
.panel {
  position: absolute;
  top: calc(100% + var(--space-2));
  left: calc(-1 * var(--space-1));
  z-index: 11;
  width: min(26rem, calc(100vw - 2 * var(--space-3)));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-2);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: 1.375rem;
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-menu);
}

.heading {
  margin: 0;
  padding: var(--space-2) var(--space-3) var(--space-1);
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: var(--font-weight-black);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.entry {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--size-touch);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: 0.875rem;
  background: transparent;
  color: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.group {
  min-height: 3.75rem;
  border-radius: var(--radius-md);
}

.group--current {
  background: var(--color-bg);
}

.house {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.375rem;
  height: 2.375rem;
  border-radius: var(--radius-full);
  background: var(--color-house-bg);
  color: var(--color-house-text);
}

.group-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.group-name {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-black);
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.group-members {
  color: var(--color-text-muted);
  font-size: 0.8125rem;
  font-weight: var(--font-weight-semibold);
}

.divider {
  margin: var(--space-1) var(--space-2);
  border-top: 1.5px solid var(--color-divider);
}

.action {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-heavy);
}

@media (min-width: 48rem) {
  .name {
    font-size: 2.375rem;
    font-weight: var(--font-weight-black);
    line-height: 2.75rem;
    letter-spacing: -0.03em;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .panel {
    width: min(23.75rem, 100%);
  }
}

/* Large screens: the name even larger (80rem: CONTEXT_COLUMN_QUERY). */
@media (min-width: 80rem) {
  .name {
    font-size: 2.5rem;
    line-height: 2.875rem;
  }

  .toggle {
    gap: var(--space-1-5);
  }

  .toggle :deep(svg) {
    width: 1.75rem;
    height: 1.75rem;
  }
}
</style>
