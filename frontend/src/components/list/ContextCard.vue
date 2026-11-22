<script setup lang="ts">
import { useId } from 'vue'

// A card of the context column (ContextColumn): a head with the title and a
// tag below it (slot `tag`), the content below scrolls inside the card.
// Collapsing a card to a bar comes with the second card (#176).
defineProps<{ title: string }>()

const titleId = useId()
</script>

<template>
  <section class="card" :aria-labelledby="titleId">
    <header class="head">
      <h2 :id="titleId" class="title">{{ title }}</h2>
      <slot name="tag" />
    </header>
    <div class="body">
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
}

.head {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-5) 0.875rem var(--space-1) 1.375rem;
}

.title {
  max-width: 100%;
  margin: 0;
  font-size: 1.6875rem;
  line-height: 2rem;
  font-weight: var(--font-weight-display);
  letter-spacing: -0.025em;
  overflow-wrap: break-word;
}

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.875rem 1.375rem 1.375rem;
}
</style>
