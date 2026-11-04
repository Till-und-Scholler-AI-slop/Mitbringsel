<script setup lang="ts">
import { useI18n } from 'vue-i18n'

// The tilted app name sticker in the green bar.
withDefaults(defineProps<{ small?: boolean }>(), { small: false })

const { t } = useI18n()
</script>

<template>
  <span :class="['logo', { 'logo--small': small }]">{{ t('app.name') }}</span>
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
</style>
