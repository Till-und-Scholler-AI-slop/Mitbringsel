<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'

// A card of the context column (ContextColumn). Open it has a head (slot
// `head`, with a collapse button if `collapsible`) and below it the content,
// which scrolls inside the card. Collapsed it is a bar with an icon (slot
// `bar-icon`), a title and a summary; a click on the bar opens the card.
// The content stays mounted while collapsed, so what was typed in a form is
// still there, but it is inert and takes no height.
//
// label: the name of the card for screen readers. barChevron: the direction
// the card opens in (the top card opens downward). collapseLabel: what the
// collapse button does, e.g. "Collapse create and open overview".
const props = defineProps<{
  label: string
  collapsed?: boolean
  collapsible?: boolean
  collapseLabel?: string
  barTitle: string
  barSummary: string
  barChevron: 'down' | 'up'
}>()
const emit = defineEmits<{ expand: []; collapse: [] }>()

const { t } = useI18n()
const bodyId = useId()
// The collapse button points the other way than the bar.
const collapseChevron = () => (props.barChevron === 'down' ? 'chevronUp' : 'chevronDown')
</script>

<template>
  <section class="card" :class="{ 'card--collapsed': collapsed }" :aria-label="label">
    <button
      v-if="collapsed"
      type="button"
      class="bar"
      aria-expanded="false"
      :aria-controls="bodyId"
      @click="emit('expand')"
    >
      <slot name="bar-icon" />
      <span class="bar-text">
        <span class="bar-title">{{ barTitle }}</span>
        <span class="bar-summary">{{ barSummary }}</span>
      </span>
      <BaseIcon
        :name="barChevron === 'down' ? 'chevronDown' : 'chevronUp'"
        :size="22"
        :stroke-width="2.75"
      />
    </button>
    <header v-else class="head">
      <div class="head-main">
        <slot name="head" />
      </div>
      <button
        v-if="collapsible"
        type="button"
        class="collapse press-inset"
        :aria-label="collapseLabel"
        :title="t('list.context.collapse')"
        @click="emit('collapse')"
      >
        <BaseIcon :name="collapseChevron()" :size="22" :stroke-width="2.75" />
      </button>
    </header>
    <div :id="bodyId" class="body" :inert="collapsed || undefined">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.card {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-xl);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-card);
  transition:
    flex-grow var(--duration-card) var(--easing-card),
    flex-basis var(--duration-card) var(--easing-card),
    transform var(--duration-press) ease;
}

.card--collapsed {
  flex: 0 0 4.75rem;
}

@media (hover: hover) and (prefers-reduced-motion: no-preference) {
  .card--collapsed:hover {
    transform: translateY(-2px);
  }
}

.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  height: calc(4.75rem - 2 * var(--border-width-md));
  padding: 0 1.125rem 0 0.8125rem;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  animation: bar-in var(--duration-bar-in) ease both;
}

.bar-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bar-title {
  font-size: 1.0625rem;
  line-height: 1.375rem;
  font-weight: var(--font-weight-display);
}

.bar-summary {
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.1875rem;
  font-weight: var(--font-weight-medium);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.head {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 0.625rem;
  padding: var(--space-5) 0.875rem var(--space-1) 1.375rem;
}

.head-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.collapse {
  flex: none;
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  padding: 0;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-full);
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.875rem 1.375rem 1.375rem;
  opacity: 1;
  transform: none;
  visibility: visible;
  transition:
    opacity var(--duration-card-fade) ease var(--delay-card-fade),
    transform var(--duration-card-slide) var(--easing-card) var(--delay-card-slide),
    visibility 0s;
}

.card--collapsed .body {
  flex: 0;
  overflow: hidden;
  padding-block: 0;
  opacity: 0;
  transform: translateY(10px);
  visibility: hidden;
  transition:
    opacity var(--duration-card-fade-out),
    transform var(--duration-card-fade-out),
    visibility 0s var(--duration-card-fade-out);
}

@keyframes bar-in {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card,
  .body,
  .card--collapsed .body {
    transition: none;
  }

  .bar {
    animation: none;
  }
}
</style>
