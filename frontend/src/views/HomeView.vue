<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useErrorMessage } from '@/composables/useErrorMessage'
import { useAuthStore } from '@/stores/auth'
import { useHealthStore } from '@/stores/health'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const health = useHealthStore()
const errorMessage = useErrorMessage(() => health.errorCode)

async function logout() {
  try {
    await auth.logout()
  } finally {
    // The store is logged out even if the request failed, so leave anyway.
    await router.push({ name: 'login' })
  }
}

onMounted(() => health.check())
</script>

<template>
  <main class="home">
    <h1>{{ t('app.name') }}</h1>

    <p v-if="auth.user" class="user">
      {{ t('home.user.signedInAs', { name: auth.user.displayName }) }}
      <button type="button" @click="logout">{{ t('home.user.logout') }}</button>
    </p>

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

.user {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
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
