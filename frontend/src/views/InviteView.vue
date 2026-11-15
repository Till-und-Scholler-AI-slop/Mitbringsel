<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import InviteCard from '@/components/invite/InviteCard.vue'
import InviteNotice from '@/components/invite/InviteNotice.vue'
import GoogleSignInButton from '@/components/login/GoogleSignInButton.vue'
import { useCountdown } from '@/composables/useCountdown'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { INVITE_PATH } from '@/services/inviteLink'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { googleLoginUrl } from '@/services/googleLogin'
import { redirectTo } from '@/services/navigation'
import { useAuthStore } from '@/stores/auth'
import { useGroupsStore } from '@/stores/groups'
import { useInvitesStore } from '@/stores/invites'

// The kinds of shops the app is made for, as stickers in the desktop header.
const SHOPS = ['supermarket', 'drugstore', 'hardware'] as const

// How long to wait after a rate limit if the server did not say.
const DEFAULT_WAIT_SECONDS = 30

type ViewState = 'loading' | 'ready' | 'invalid' | 'limit' | 'failed'

const props = defineProps<{ token: string }>()

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const invites = useInvitesStore()
const groups = useGroupsStore()
const countdown = useCountdown()

// The error of the last "Join" click. Errors of loading the invite are in the store.
const acceptError = ref<{ code: string; retryAfter: number | null } | null>(null)
const joining = ref(false)
const redirecting = ref(false)

// Anyone may open the invite page. Whoever is not signed in joins after the
// Google login, which leads back here. 'error' (server unreachable) is not
// treated as signed out; joining then fails with the error shown below.
const anonymous = computed(() => auth.status === 'anonymous')

const errorCode = computed(() => acceptError.value?.code ?? invites.errorCode)
const errorMessage = useErrorMessage(errorCode)
const retryAfter = computed(() => acceptError.value?.retryAfter ?? invites.retryAfterSeconds)

const state = computed<ViewState>(() => {
  if (errorCode.value === 'RATE_LIMITED') return 'limit'
  if (errorCode.value === 'INVITE_NOT_FOUND' || errorCode.value === 'INVITE_EXPIRED') {
    return 'invalid'
  }
  if (invites.status === 'error') return 'failed'
  return invites.status === 'ready' ? 'ready' : 'loading'
})

// Any other error of "Join" (e.g. no connection) shows below the button and
// the user can try again; the invite itself is still fine.
const joinProblem = computed(() => state.value === 'ready' && acceptError.value !== null)

const title = computed(() =>
  state.value === 'loading' || state.value === 'ready'
    ? t('invite.title')
    : t(`invite.${state.value}.title`),
)

watch(
  () => props.token,
  async (token) => {
    acceptError.value = null
    // The join dialog has loaded the invite already; then nothing to do.
    if (!invites.has(token)) await invites.load(token)
  },
  { immediate: true },
)

watch(
  state,
  (current) => {
    if (current === 'limit') countdown.start(retryAfter.value ?? DEFAULT_WAIT_SECONDS)
  },
  { immediate: true },
)

// The invite is only for this visit.
onBeforeUnmount(() => invites.clear())

async function join() {
  joining.value = true
  acceptError.value = null
  try {
    await invites.accept(props.token)
    // Load never throws; if it fails, the start page shows the error and a retry.
    await groups.load()
    await router.push({ name: 'home' })
  } catch (err) {
    acceptError.value =
      err instanceof ApiError
        ? { code: err.code, retryAfter: err.retryAfterSeconds ?? null }
        : { code: ERROR_CODE_UNKNOWN, retryAfter: null }
  } finally {
    joining.value = false
  }
}

function signInToJoin() {
  redirecting.value = true
  redirectTo(googleLoginUrl(`${INVITE_PATH}${props.token}`))
}

// Coming back from Google with the back button can restore this page from
// the browser's back/forward cache exactly as it was left: still redirecting.
function onPageShow(event: PageTransitionEvent) {
  if (event.persisted) redirecting.value = false
}
onMounted(() => window.addEventListener('pageshow', onPageShow))
onBeforeUnmount(() => window.removeEventListener('pageshow', onPageShow))

async function retry() {
  const loadFailed = invites.status === 'error'
  acceptError.value = null
  if (loadFailed) await invites.load(props.token)
}
</script>

<template>
  <div class="invite">
    <!-- Phone: a green bar on top. Desktop: the left half of the page, with
         slogan and shop chips (design "markt2-einladung-desktop-*"). -->
    <header class="bar">
      <BrandLogo class="logo--phone" small />
      <BrandLogo class="logo--desktop" large />
      <div class="heading">
        <h1 class="title">{{ title }}</h1>
        <p class="tagline">{{ t('invite.tagline') }}</p>
      </div>
      <div class="chips" aria-hidden="true">
        <span v-for="shop in SHOPS" :key="shop" :class="['chip', `chip--${shop}`]">
          {{ t(`login.shops.${shop}`) }}
        </span>
      </div>
    </header>

    <main class="content">
      <p v-if="state === 'loading'" class="loading" role="status">
        <BaseSpinner /> {{ t('invite.loadingText') }}
      </p>

      <template v-else-if="state === 'ready' && invites.preview">
        <InviteCard :preview="invites.preview" />
        <p v-if="joinProblem" class="problem" role="alert">
          <BaseIcon name="alert" /> {{ errorMessage }}
        </p>
        <div class="spacer" />
        <template v-if="anonymous">
          <p class="sign-in-note">{{ t('invite.signInNote') }}</p>
          <GoogleSignInButton
            class="action"
            :busy="redirecting"
            :label="t('invite.joinWithGoogle')"
            @click="signInToJoin"
          />
        </template>
        <BaseButton v-else class="action" :loading="joining" @click="join">
          {{ t('invite.join') }}
        </BaseButton>
      </template>

      <template v-else-if="state === 'invalid'">
        <InviteNotice
          icon="linkOff"
          :title="t('invite.invalid.card')"
          :body="t('invite.invalid.body')"
        />
        <div class="spacer" />
        <BaseButton class="action" @click="router.push({ name: 'home' })">
          {{ t('invite.invalid.home') }}
        </BaseButton>
      </template>

      <template v-else-if="state === 'limit'">
        <InviteNotice icon="clock" :title="t('invite.limit.card')" :body="t('invite.limit.body')">
          <p v-if="countdown.running.value" class="wait" role="status">
            <BaseIcon name="clock" :size="18" />
            {{ t('invite.limit.wait', { seconds: countdown.remaining.value }) }}
          </p>
          <p class="stays-valid">{{ t('invite.limit.stillValid') }}</p>
        </InviteNotice>
        <div class="spacer" />
        <BaseButton class="action" :disabled="countdown.running.value" @click="retry">
          {{
            countdown.running.value
              ? t('invite.limit.retryIn', { seconds: countdown.remaining.value })
              : t('common.retry')
          }}
        </BaseButton>
      </template>

      <template v-else>
        <InviteNotice icon="alert" :title="t('invite.failed.card')" :body="errorMessage" />
        <div class="spacer" />
        <BaseButton class="action" @click="retry">
          <BaseIcon name="retry" /> {{ t('common.retry') }}
        </BaseButton>
      </template>
    </main>
  </div>
</template>

<style scoped>
.invite {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

.bar {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-4) var(--space-6);
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.title {
  margin: 0;
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-heading);
  letter-spacing: -0.03em;
  overflow-wrap: break-word;
}

.heading {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* Desktop-only parts of the header. With .bar in front, these win over
   the display of BrandLogo's own root class. */
.bar .logo--desktop,
.tagline,
.chips {
  display: none;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  width: 100%;
  max-width: 30rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4) var(--space-8);
}

.spacer {
  flex: 1;
}

.action {
  width: 100%;
  min-height: var(--size-touch);
}

.loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  color: var(--color-text-muted);
}

.problem {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  align-self: stretch;
  margin: 0;
  color: var(--color-danger-text);
  font-weight: var(--font-weight-bold);
}

.wait {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-bg);
  font-weight: var(--font-weight-heavy);
  font-variant-numeric: tabular-nums;
}

.sign-in-note {
  align-self: stretch;
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  text-align: center;
}

.stays-valid {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}

/* Desktop: header and content side by side. The header starts at 420 px,
   the content takes the rest; in a narrow window (up to about 880 px) the
   content wraps below. */
@media (min-width: 48rem) {
  .invite {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .bar {
    flex: 1 1 26.25rem;
    min-width: 0;
    justify-content: space-between;
    gap: var(--space-12);
    padding: var(--space-12) var(--space-14);
    border-radius: 0 2.5rem 2.5rem 0;
  }

  .bar .logo--phone {
    display: none;
  }

  .bar .logo--desktop {
    display: inline-block;
  }

  .title {
    font-size: 3.5rem;
    line-height: 3.875rem;
  }

  .tagline {
    display: block;
    max-width: 26.25rem;
    margin: 0;
    font-size: 1.25rem;
    font-weight: var(--font-weight-bold);
    line-height: 1.75rem;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    row-gap: var(--space-3);
    padding: var(--space-1) 0 var(--space-1) var(--space-1);
  }

  .content {
    flex: 999 1 28.75rem;
    justify-content: center;
    gap: var(--space-5);
    min-width: 0;
    max-width: none;
    margin: 0;
    padding: var(--space-12) var(--space-8);
  }

  /* Everything in one centered column as wide as the card. */
  .content > * {
    align-self: center;
    width: 100%;
    max-width: 30rem;
  }

  .spacer {
    display: none;
  }
}

/* Overlapping, slightly turned stickers in the shop colors. */
.chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-height: var(--size-touch);
  padding: 0 1.125rem;
  border: var(--border-width-sm) solid var(--color-on-accent);
  border-radius: var(--radius-full);
  color: var(--color-on-accent);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-heavy);
  white-space: nowrap;
  box-shadow: var(--shadow-sticker);
}

.chip + .chip {
  margin-left: calc(-1 * var(--space-2));
}

.chip--supermarket {
  z-index: 3;
  background: var(--color-accent-tomato);
  transform: rotate(-4deg);
}

.chip--drugstore {
  z-index: 2;
  background: var(--color-accent-lilac);
  transform: rotate(3deg);
}

.chip--hardware {
  z-index: 1;
  background: var(--color-accent-sky);
  transform: rotate(-2deg);
}
</style>
