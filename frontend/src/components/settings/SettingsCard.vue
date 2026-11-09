<script setup lang="ts">
import { useId } from 'vue'

// One section of the settings page: a card with a small heading, an
// optional element next to it (a button, a count) and the content below.
// danger: the card for leaving or deleting, with a red border.
withDefaults(defineProps<{ title: string; danger?: boolean }>(), { danger: false })

const titleId = useId()
</script>

<template>
  <section :class="['card', { 'card--danger': danger }]" :aria-labelledby="titleId">
    <div class="head">
      <h2 :id="titleId" class="title">{{ title }}</h2>
      <slot name="aside" />
    </div>
    <slot />
  </section>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: var(--space-4) 1.125rem 1.125rem;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sticker);
}

/* No sticker shadow: the red border alone sets it apart. */
.card--danger {
  border-color: var(--color-danger);
  box-shadow: none;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
  font-weight: var(--font-weight-black);
  line-height: 1.125rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.card--danger .title {
  color: var(--color-danger-text);
}
</style>
