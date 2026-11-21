<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'
import type { IconName } from '@/components/base/icons'

/**
 * The sync chip of the design: white with a ticked cloud while synced, dark
 * with a crossed-out cloud while offline, and yellow whenever changes are
 * still in the outbox (upload cloud online, crossed-out cloud offline). It
 * only shows what its props say, so it can be tested without the stores.
 *
 * md fits the green headers of the phone; lg is the sidebar version, with a
 * longer label and, with `hint`, a line that says what the state means.
 */
const props = withDefaults(
  defineProps<{
    state: 'synced' | 'offline'
    pendingCount?: number
    size?: 'md' | 'lg'
    hint?: boolean
    householdName?: string
  }>(),
  { pendingCount: 0, size: 'md', hint: false },
)

const { t } = useI18n()

const pending = computed(() => Math.max(0, props.pendingCount))
const hasPending = computed(() => pending.value > 0)
const offline = computed(() => props.state === 'offline')

const chipClass = computed(() => {
  if (hasPending.value) return 'chip--pending'
  return offline.value ? 'chip--offline' : 'chip--synced'
})

const icon = computed<IconName>(() => {
  if (offline.value) return 'cloudOff'
  return hasPending.value ? 'cloudUpload' : 'cloudCheck'
})

const label = computed(() => {
  if (offline.value && hasPending.value) {
    return t('sync.offlinePending', { count: pending.value })
  }
  if (offline.value) return t('sync.offline')
  if (hasPending.value) return t('sync.pending', { count: pending.value })
  return props.size === 'lg' ? t('sync.syncedLong') : t('sync.synced')
})

const ariaLabel = computed(() => {
  if (offline.value && hasPending.value) {
    return t('sync.aria.offlinePending', { count: pending.value })
  }
  if (offline.value) return t('sync.aria.offline')
  if (hasPending.value) return t('sync.aria.pending', { count: pending.value })
  return t('sync.aria.synced')
})

const hintText = computed(() => {
  if (offline.value) return t('sync.offlineHint')
  if (hasPending.value) {
    return props.householdName
      ? t('sync.pendingHintIn', { name: props.householdName })
      : t('sync.pendingHint')
  }
  return t('sync.syncedHint')
})

const iconSize = computed(() => (props.size === 'lg' ? 18 : 16))
</script>

<template>
  <div :class="['sync', `sync--${size}`]">
    <!-- role="status": screen readers announce the change, without interrupting. -->
    <span :class="['chip', chipClass]" role="status" :aria-label="ariaLabel">
      <BaseIcon :name="icon" :size="iconSize" :stroke-width="2.5" />
      {{ label }}
    </span>
    <p v-if="hint" class="hint">{{ hintText }}</p>
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

/* Yellow sticker in both themes while changes wait in the outbox. */
.chip--pending {
  border-color: var(--color-on-accent);
  background: var(--color-accent-sun);
  color: var(--color-on-accent);
}

.hint {
  margin: 0;
  padding: 0 var(--space-1);
  font-size: 0.8125rem;
  line-height: 1.125rem;
  font-weight: var(--font-weight-medium);
}
</style>
