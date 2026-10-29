<script setup lang="ts">
// Placeholder until the login design from Claude Design is implemented.
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useErrorMessage } from '@/composables/useErrorMessage'
import { useAuthStore } from '@/stores/auth'

// The backend redirects to Google from here; the endpoint follows with the
// Google login step and answers 404 until then.
const GOOGLE_LOGIN_URL = '/api/v1/auth/google/login'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const errorMessage = useErrorMessage(() => auth.errorCode)

// Asks the backend again. In development load() also logs in as the dev
// user, so the same function serves the retry and the dev login button.
async function loadAndContinue() {
  await auth.load()
  if (auth.status === 'authenticated') {
    await router.push({ name: 'home' })
  }
}
</script>

<template>
  <main class="login">
    <h1>{{ t('app.name') }}</h1>
    <p>{{ t('login.intro') }}</p>

    <p v-if="auth.status === 'error'" role="alert">
      {{ errorMessage }}
      <button type="button" @click="loadAndContinue">{{ t('login.retry') }}</button>
    </p>

    <div class="actions">
      <a class="google" :href="GOOGLE_LOGIN_URL">{{ t('login.google') }}</a>
      <button v-if="auth.devUserEmail" type="button" class="dev" @click="loadAndContinue">
        {{ t('login.devLogin', { email: auth.devUserEmail }) }}
      </button>
    </div>
  </main>
</template>

<style scoped>
.login {
  max-width: 40rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.google,
button {
  display: inline-flex;
  align-items: center;
  min-height: var(--size-touch);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--color-primary-contrast);
  font: inherit;
  text-decoration: none;
  cursor: pointer;
}
</style>
