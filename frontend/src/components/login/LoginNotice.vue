<script setup lang="ts">
import { computed } from 'vue'

import BaseIcon from '@/components/base/BaseIcon.vue'
import type { IconName } from '@/components/base/icons'

export type LoginNoticeKind = 'error' | 'session' | 'offline'

// A hint card above the sign-in button. The body text goes into the default
// slot, buttons into the actions slot. Offline shows its title as a chip.
const props = defineProps<{ kind: LoginNoticeKind; title: string }>()

const ICON: Record<LoginNoticeKind, IconName> = {
  error: 'alert',
  session: 'logOut',
  offline: 'cloudOff',
}

// Errors interrupt the screen reader at once; the others wait their turn.
const role = computed(() => (props.kind === 'error' ? 'alert' : 'status'))
</script>

<template>
  <div :class="['notice', `notice--${kind}`]" :role="role">
    <template v-if="kind === 'offline'">
      <span class="chip"><BaseIcon :name="ICON.offline" />{{ title }}</span>
      <span class="body"><slot /></span>
    </template>
    <div v-else class="content">
      <span class="icon"><BaseIcon :name="ICON[kind]" /></span>
      <span class="text">
        <span class="title">{{ title }}</span>
        <span class="body"><slot /></span>
      </span>
    </div>
    <div v-if="$slots.actions" class="actions"><slot name="actions" /></div>
  </div>
</template>

<style scoped>
.notice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  max-width: 25rem;
  padding: var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  overflow-wrap: break-word;
}

.content {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
}

.icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-full);
}

.text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-black);
  line-height: 1.3;
}

.body {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  line-height: var(--line-height-body);
}

/* Error: red frame, red title, body stays in the normal text color. */
.notice--error {
  border-color: var(--color-danger);
  background: var(--color-danger-surface);
}

.notice--error .icon {
  background: var(--color-danger);
  color: var(--color-on-danger);
}

.notice--error .title {
  color: var(--color-danger-text);
}

/* Session expired: calm, yellow sign-out icon, muted body. */
.notice--session .icon {
  border: var(--border-width-sm) solid var(--color-on-accent);
  background: var(--color-accent-sun);
  color: var(--color-on-accent);
}

.notice--session .body {
  color: var(--color-text-muted);
}

/* Offline: dashed frame like something missing, chip as in the sync indicator. */
.notice--offline {
  border-style: dashed;
}

.notice--offline .body {
  font-weight: var(--font-weight-semibold);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 2.5rem;
  padding: 0 var(--space-3);
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-offline-bg);
  color: var(--color-offline-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
}
</style>
