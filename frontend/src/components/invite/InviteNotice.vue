<script setup lang="ts">
import BaseIcon from '@/components/base/BaseIcon.vue'
import type { IconName } from '@/components/base/icons'

// A card for an invite that cannot be used (invalid, rate limited, failed):
// a yellow sticker with an icon, a title and a text. The default slot takes
// extra content below the text, e.g. the waiting time.
defineProps<{ icon: IconName; title: string; body: string }>()
</script>

<template>
  <section class="notice" :aria-label="title">
    <span class="sticker" aria-hidden="true"><BaseIcon :name="icon" :size="28" /></span>
    <h2 class="title">{{ title }}</h2>
    <p class="body">{{ body }}</p>
    <slot />
  </section>
</template>

<style scoped>
.notice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sticker);
}

.sticker {
  display: grid;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  border: var(--border-width-md) solid var(--color-on-accent);
  border-radius: var(--radius-full);
  background: var(--color-accent-sun);
  color: var(--color-on-accent);
  box-shadow: var(--shadow-sticker);
  transform: rotate(-6deg);
}

.title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-display);
  line-height: var(--line-height-heading);
  letter-spacing: -0.025em;
  overflow-wrap: break-word;
}

.body {
  margin: 0;
  color: var(--color-text-muted);
  overflow-wrap: break-word;
}
</style>
