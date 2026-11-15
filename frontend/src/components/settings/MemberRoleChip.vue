<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import type { Role } from '@/types/api'

// The role of a member as a small chip: owner tomato, admin lilac, member
// plain. Used in the member list and in the member's actions dialog.
defineProps<{ role: Role }>()

const { t } = useI18n()
</script>

<template>
  <span :class="['role', `role--${role}`]">{{ t(`settings.roles.${role}`) }}</span>
</template>

<style scoped>
.role {
  padding: 1px 0.625rem;
  border: var(--border-width-sm) solid var(--color-on-accent);
  border-radius: var(--radius-full);
  font-size: 0.8125rem;
  font-weight: var(--font-weight-heavy);
  line-height: 1.125rem;
}

.role--owner {
  background: var(--color-accent-tomato);
  color: var(--color-on-accent);
}

.role--admin {
  background: var(--color-accent-lilac);
  color: var(--color-on-accent);
}

.role--member {
  border-color: var(--color-divider);
  background: var(--color-bg);
  color: var(--color-text);
}
</style>
