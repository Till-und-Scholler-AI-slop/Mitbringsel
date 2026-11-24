<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'

// Explains what is unavailable (or still possible) while the browser is offline.
// card: dashed box with the dark Offline badge for page-level notices (start,
// settings, invite). inline: compact line with an icon for menus, empty states
// and dialogs; onBrand switches it to light ink on the green sidebar.
withDefaults(
  defineProps<{
    text: string
    variant?: 'card' | 'inline'
    onBrand?: boolean
  }>(),
  { variant: 'card', onBrand: false },
)

const { t } = useI18n()
</script>

<template>
  <p
    :class="[
      'offline-notice',
      `offline-notice--${variant}`,
      { 'offline-notice--on-brand': onBrand },
    ]"
    role="status"
  >
    <span v-if="variant === 'card'" class="badge">
      <BaseIcon name="cloudOff" /> {{ t('offline.badge') }}
    </span>
    <BaseIcon v-else class="icon" name="cloudOff" :size="16" />
    <span>{{ text }}</span>
  </p>
</template>

<style scoped>
.offline-notice {
  display: flex;
  margin: 0;
  overflow-wrap: break-word;
}

.offline-notice--card {
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: var(--border-width-md) dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  font-weight: var(--font-weight-semibold);
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1-5) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--color-offline-bg);
  color: var(--color-offline-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
}

.offline-notice--inline {
  align-items: flex-start;
  gap: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  line-height: 1.3;
}

.offline-notice--on-brand {
  color: var(--color-on-brand);
}

.icon {
  flex: none;
  margin-top: 2px;
}
</style>
