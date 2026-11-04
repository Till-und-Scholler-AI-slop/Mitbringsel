<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import { useCountdown } from '@/composables/useCountdown'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { extractInviteToken } from '@/services/inviteLink'
import { useInvitesStore } from '@/stores/invites'

// How long to wait after a rate limit if the server did not say.
const DEFAULT_WAIT_SECONDS = 30

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const router = useRouter()
const invites = useInvitesStore()
const countdown = useCountdown()

const link = ref('')
const checking = ref(false)
// The text is not an invite link at all; known without asking the server.
const notALink = ref(false)
const serverCode = ref<string | null>(null)
const serverMessage = useErrorMessage(serverCode)

const limited = computed(() => serverCode.value === 'RATE_LIMITED')
const waiting = computed(() => limited.value && countdown.running.value)

// While the limit holds, its own box says so, not the field.
const error = computed(() => {
  if (notALink.value) return t('join.notALink')
  return serverCode.value && !limited.value ? serverMessage.value : null
})

watch(open, (isOpen) => {
  if (isOpen) {
    link.value = ''
    notALink.value = false
    serverCode.value = null
  }
})

watch(link, () => {
  notALink.value = false
  if (!limited.value) serverCode.value = null
})

// Reading the clipboard needs the user's permission, which they may refuse
// (or the browser has no such API); then they paste by hand.
async function paste() {
  try {
    link.value = await navigator.clipboard.readText()
  } catch {
    // Nothing to do: the field stays as it is.
  }
}

// Checks the link with the server first, so a dead link is explained here
// and the user does not land on an error page.
async function submit() {
  const token = extractInviteToken(link.value)
  if (token === null) {
    notALink.value = true
    return
  }
  checking.value = true
  serverCode.value = null
  await invites.load(token)
  checking.value = false

  if (invites.status === 'ready') {
    open.value = false
    await router.push({ name: 'invite', params: { token } })
    return
  }
  serverCode.value = invites.errorCode
  if (limited.value) countdown.start(invites.retryAfterSeconds ?? DEFAULT_WAIT_SECONDS)
}
</script>

<template>
  <BaseDialog v-model:open="open" :title="t('join.title')">
    <form class="form" novalidate @submit.prevent="submit">
      <p class="intro">{{ t('join.intro') }}</p>

      <BaseInput
        v-model="link"
        :label="t('join.linkLabel')"
        :placeholder="t('join.placeholder')"
        :error="error"
        inputmode="url"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        autofocus
      >
        <template #suffix>
          <BaseButton variant="secondary" class="paste" @click="paste">
            <BaseIcon name="clipboard" /> {{ t('join.paste') }}
          </BaseButton>
        </template>
      </BaseInput>

      <div v-if="waiting" class="limit" role="status">
        <span class="limit-title">{{ t('join.limit.title') }}</span>
        {{ t('join.limit.body', { seconds: countdown.remaining.value }) }}
      </div>

      <BaseButton type="submit" :loading="checking" :disabled="link.trim() === '' || waiting">
        {{ waiting ? t('join.wait', { seconds: countdown.remaining.value }) : t('join.submit') }}
      </BaseButton>

      <div class="no-link">
        <span class="no-link-title">{{ t('join.noLink.title') }}</span>
        {{ t('join.noLink.body') }}
      </div>
    </form>
  </BaseDialog>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.intro {
  margin: 0;
  color: var(--color-text-muted);
  overflow-wrap: break-word;
}

.paste {
  flex: none;
  padding: 0 var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
}

.limit,
.no-link {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3);
  border-radius: var(--radius-lg);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  overflow-wrap: break-word;
}

.limit {
  border: var(--border-width-md) solid var(--color-border);
  background: var(--color-bg);
}

.no-link {
  border: var(--border-width-md) dashed var(--color-text-muted);
}

.limit-title,
.no-link-title {
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-black);
}
</style>
