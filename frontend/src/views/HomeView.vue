<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import { ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { useHealthStore } from '@/stores/health'

const { t, te } = useI18n()
const health = useHealthStore()

// Codes the frontend has no translation for fall back to the generic message.
const errorMessage = computed(() => {
  const code = health.errorCode ?? ERROR_CODE_UNKNOWN
  return t(te(`errors.${code}`) ? `errors.${code}` : `errors.${ERROR_CODE_UNKNOWN}`)
})

onMounted(() => health.check())
</script>

<template>
  <main class="home">
    <h1>{{ t('app.name') }}</h1>

    <p class="status" role="status">
      <span class="label">{{ t('home.backend.label') }}:</span>
      <span v-if="health.state === 'loading' || health.state === 'idle'">
        {{ t('home.backend.loading') }}
      </span>
      <span v-else-if="health.state === 'ok'" class="ok">{{ t('home.backend.ok') }}</span>
      <span v-else class="error">{{ errorMessage }}</span>
    </p>

    <button v-if="health.state === 'error'" type="button" @click="health.check()">
      {{ t('home.backend.retry') }}
    </button>
  </main>
</template>

<style scoped>
.home {
  max-width: 40rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}

.label {
  color: var(--color-text-muted);
  margin-right: var(--space-2);
}

.ok {
  color: var(--color-success);
}

.error {
  color: var(--color-danger);
}

button {
  min-height: var(--size-touch);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-primary-contrast);
  font: inherit;
  cursor: pointer;
}
</style>
