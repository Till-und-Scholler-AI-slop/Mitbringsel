<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import InviteCard from '@/components/invite/InviteCard.vue'
import InviteNotice from '@/components/invite/InviteNotice.vue'
import { useCountdown } from '@/composables/useCountdown'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { useGroupsStore } from '@/stores/groups'
import { useInvitesStore } from '@/stores/invites'

// How long to wait after a rate limit if the server did not say.
const DEFAULT_WAIT_SECONDS = 30

type ViewState = 'loading' | 'ready' | 'invalid' | 'limit' | 'failed'

const props = defineProps<{ token: string }>()

const { t } = useI18n()
const router = useRouter()
const invites = useInvitesStore()
const groups = useGroupsStore()
const countdown = useCountdown()

// The error of the last "Join" click. Errors of loading the invite are in the store.
const acceptError = ref<{ code: string; retryAfter: number | null } | null>(null)
const joining = ref(false)

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

async function retry() {
  const loadFailed = invites.status === 'error'
  acceptError.value = null
  if (loadFailed) await invites.load(props.token)
}
</script>

<template>
  <div class="invite">
    <header class="bar">
      <BrandLogo small />
      <h1 class="title">{{ title }}</h1>
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
        <BaseButton class="action" :loading="joining" @click="join">
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

.stays-valid {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}
</style>
