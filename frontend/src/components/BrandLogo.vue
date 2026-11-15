<script setup lang="ts">
import { useI18n } from 'vue-i18n'

// The tilted app name sticker in the green bar. flat: without the sticker
// shadow, as in the compact head of the list view. large: the big sticker
// of a desktop brand panel (invite page).
withDefaults(defineProps<{ small?: boolean; large?: boolean; flat?: boolean }>(), {
  small: false,
  large: false,
  flat: false,
})

const { t } = useI18n()
</script>

<template>
  <span :class="['logo', { 'logo--small': small, 'logo--large': large, 'logo--flat': flat }]">{{
    t('app.name')
  }}</span>
</template>

<style scoped>
.logo {
  display: inline-block;
  padding: var(--space-1-5) var(--space-4);
  border-radius: var(--radius-full);
  background: var(--color-accent-tomato);
  color: var(--color-on-accent);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-tight);
  letter-spacing: -0.01em;
  box-shadow: var(--shadow-sticker);
  transform: rotate(-3deg);
}

.logo--small {
  padding: var(--space-1) var(--space-3);
  font-size: var(--font-size-md);
}
.logo--large {
  padding: var(--space-2) var(--space-5);
  font-size: 2rem;
}

.logo--flat {
  box-shadow: none;
}
</style>
