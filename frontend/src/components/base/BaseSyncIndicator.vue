<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'

/**
 * The sync chip of the design: white with a ticked cloud while synced, dark
 * with a crossed-out cloud while offline. It only shows a state; which one
 * comes from the sync store (`indicator`), so it can be tested without one.
 * "Pending" joins with the outbox in phase 6.
 *
 * md fits the green headers of the phone; lg is the sidebar version, with a
 * longer label and, with `hint`, a line that says what the state means.
 */
const props = withDefaults(
  defineProps<{
    state: 'synced' | 'offline'
    size?: 'md' | 'lg'
    hint?: boolean
  }>(),
  { size: 'md', hint: false },
)

const { t } = useI18n()

const synced = computed(() => props.state === 'synced')
const label = computed(() => {
  if (!synced.value) return t('sync.offline')
  return props.size === 'lg' ? t('sync.syncedLong') : t('sync.synced')
})
const iconSize = computed(() => (props.size === 'lg' ? 18 : 16))
</script>

<template>
  <!-- role="status": screen readers announce the change, without interrupting. -->
  <div :class="['sync', `sync--${size}`]" role="status">
    <span :class="['chip', synced ? 'chip--synced' : 'chip--offline']">
      <BaseIcon :name="synced ? 'cloudCheck' : 'cloudOff'" :size="iconSize" :stroke-width="2.5" />
      {{ label }}
    </span>
    <p v-if="hint" class="hint">{{ synced ? t('sync.syncedHint') : t('sync.offlineHint') }}</p>
  </div>
</template>

<style scoped>
.sync {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1-5);
  min-height: 2.75rem;
  padding: 0 var(--space-3);
  box-sizing: border-box;
  border: var(--border-width-sm) solid;
  border-radius: var(--radius-full);
  font-size: 0.8125rem; /* 13px */
  font-weight: var(--font-weight-heavy);
  white-space: nowrap;
}

.sync--lg .chip {
  gap: var(--space-2);
  padding: 0 0.875rem;
  font-size: var(--font-size-xs);
}

/* A white sticker in both themes, like the other chips on the green header. */
.chip--synced {
  border-color: var(--color-on-accent);
  background: var(--color-accent-white);
  color: var(--color-on-accent);
}

.chip--offline {
  border-color: var(--color-offline-border);
  background: var(--color-offline-bg);
  color: var(--color-offline-text);
}

.hint {
  margin: 0;
  padding: 0 var(--space-1);
  font-size: 0.8125rem;
  line-height: 1.125rem;
  font-weight: var(--font-weight-medium);
}
</style>
