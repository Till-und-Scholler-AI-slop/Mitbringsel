<script setup lang="ts">
// A dashed box for "nothing here yet". The icon slot takes a BaseIcon, the
// default slot the actions that fill the emptiness (buttons).
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <section class="empty-state">
    <span v-if="$slots.icon" class="icon"><slot name="icon" /></span>
    <h2 class="title">{{ title }}</h2>
    <p v-if="description" class="description">{{ description }}</p>
    <div v-if="$slots.default" class="actions"><slot /></div>
  </section>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-5);
  border: var(--border-width-md) dashed var(--color-text-muted);
  border-radius: var(--radius-lg);
}

.icon {
  display: grid;
  place-items: center;
  width: var(--size-touch);
  height: var(--size-touch);
  border-radius: var(--radius-full);
  background: var(--color-accent-lilac);
  color: var(--color-on-accent);
}

.title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-display);
  line-height: var(--line-height-heading);
  letter-spacing: -0.02em;
  overflow-wrap: break-word;
}

.description {
  margin: 0;
  color: var(--color-text-muted);
  overflow-wrap: break-word;
}

.actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  align-self: stretch;
}
</style>
