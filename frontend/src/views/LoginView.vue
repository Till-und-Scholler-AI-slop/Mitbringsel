<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import LanguageSwitch from '@/components/LanguageSwitch.vue'
import GoogleSignInButton from '@/components/login/GoogleSignInButton.vue'
import LoginLayout from '@/components/login/LoginLayout.vue'
import LoginNotice from '@/components/login/LoginNotice.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import {
  LOGIN_QUERY_ERROR,
  LOGIN_QUERY_REASON,
  LOGIN_REASON_SESSION_EXPIRED,
} from '@/router/loginQuery'
import { redirectTo } from '@/services/navigation'
import { useAuthStore } from '@/stores/auth'

// The backend redirects to Google from here (docs/auth.md).
const GOOGLE_LOGIN_URL = '/api/v1/auth/google/login'

type Notice = 'offline' | 'serverError' | 'loginFailed' | 'sessionExpired'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const errorMessage = useErrorMessage(() => auth.errorCode)
const { online } = useOnlineStatus()

const redirecting = ref(false)

// At most one notice, the most pressing first. While redirecting, older
// notices are out of date and disappear.
const notice = computed<Notice | null>(() => {
  if (!online.value) return 'offline'
  if (redirecting.value) return null
  if (auth.status === 'error') return 'serverError'
  if (route.query[LOGIN_QUERY_ERROR] !== undefined) return 'loginFailed'
  if (route.query[LOGIN_QUERY_REASON] === LOGIN_REASON_SESSION_EXPIRED) return 'sessionExpired'
  return null
})

function signInWithGoogle() {
  redirecting.value = true
  redirectTo(GOOGLE_LOGIN_URL)
}

// Asks the backend again. In development load() also logs in as the dev
// user, so the same function serves the retry and the dev login button.
async function loadAndContinue() {
  await auth.load()
  if (auth.status === 'authenticated') {
    await router.push({ name: 'home' })
  }
}

// Coming back from Google with the back button can restore this page from
// the browser's back/forward cache exactly as it was left: still redirecting.
function onPageShow(event: PageTransitionEvent) {
  if (event.persisted) {
    redirecting.value = false
  }
}
onMounted(() => window.addEventListener('pageshow', onPageShow))
onBeforeUnmount(() => window.removeEventListener('pageshow', onPageShow))
</script>

<template>
  <LoginLayout>
    <div class="intro">
      <h1>{{ t('login.title') }}</h1>
      <!-- On the desktop the slogan sits in the brand header instead. -->
      <p class="tagline">{{ t('login.tagline') }}</p>
      <p class="lead">{{ t('login.lead') }}</p>
    </div>

    <LoginNotice v-if="notice === 'offline'" kind="offline" :title="t('login.offline.title')">
      {{ t('login.offline.body') }}
    </LoginNotice>
    <LoginNotice
      v-else-if="notice === 'serverError'"
      kind="error"
      :title="t('login.serverError.title')"
    >
      {{ errorMessage }}
      <template #actions>
        <BaseButton class="retry" @click="loadAndContinue">
          <BaseIcon name="retry" />{{ t('login.retry') }}
        </BaseButton>
      </template>
    </LoginNotice>
    <LoginNotice v-else-if="notice === 'loginFailed'" kind="error" :title="t('login.failed.title')">
      {{ t('login.failed.body') }}
      <template #actions>
        <BaseButton class="retry" @click="signInWithGoogle">
          <BaseIcon name="retry" />{{ t('login.retry') }}
        </BaseButton>
      </template>
    </LoginNotice>
    <LoginNotice
      v-else-if="notice === 'sessionExpired'"
      kind="session"
      :title="t('login.sessionExpired.title')"
    >
      {{ t('login.sessionExpired.body') }}
    </LoginNotice>

    <GoogleSignInButton :disabled="!online" :busy="redirecting" @click="signInWithGoogle" />

    <div v-if="redirecting" class="redirecting" role="status">
      <span class="spinner"><BaseSpinner /></span>
      {{ t('login.redirecting') }}
    </div>

    <BaseButton
      v-if="auth.devUserEmail"
      variant="secondary"
      class="dev"
      :loading="auth.status === 'loading'"
      @click="loadAndContinue"
    >
      {{ t('login.devLogin', { email: auth.devUserEmail }) }}
    </BaseButton>

    <footer class="footer">
      <LanguageSwitch />
    </footer>
  </LoginLayout>
</template>

<style scoped>
.intro {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

h1 {
  margin: 0;
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-heading);
  letter-spacing: -0.03em;
  overflow-wrap: break-word;
}

.tagline,
.lead {
  max-width: 27.5rem;
  margin: 0;
  overflow-wrap: break-word;
}

.tagline {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
}

.lead {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
}

.retry,
.dev {
  align-self: flex-start;
}

.redirecting {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  max-width: 25rem;
  min-height: var(--size-touch);
  margin-top: calc(-1 * var(--space-2));
  font-weight: var(--font-weight-bold);
}

.spinner {
  display: flex;
  color: var(--color-primary);
}

/* Pushed to the bottom of the screen (phone) or the card (desktop). */
.footer {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-2) var(--space-3);
  margin-top: auto;
}

/* On the desktop the slogan sits in the brand header instead. */
@media (min-width: 48rem) {
  .tagline {
    display: none;
  }
}
</style>
