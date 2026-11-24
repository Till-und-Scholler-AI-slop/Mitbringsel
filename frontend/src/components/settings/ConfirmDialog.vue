<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseOfflineNotice from '@/components/base/BaseOfflineNotice.vue'
import { useOnlineStatus } from '@/composables/useOnlineStatus'

// A question with a cancel and a dangerous confirm button. The parent runs
// the action on `confirm` and closes the dialog when it worked; a failure
// goes in `error` and the dialog stays open.
// requireOnline: opt-in for actions that need a connection (household leave
// and delete, logout); offlineHint overrides the default inline notice text.
const props = withDefaults(
  defineProps<{
    title: string
    message: string
    confirmLabel: string
    cancelLabel: string
    loading?: boolean
    error?: string | null
    requireOnline?: boolean
    offlineHint?: string
  }>(),
  { loading: false, error: null, requireOnline: false, offlineHint: undefined },
)
defineEmits<{ confirm: [] }>()

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const { online } = useOnlineStatus()
const blockedOffline = computed(() => props.requireOnline && !online.value)
</script>

<template>
  <BaseDialog v-model:open="open" :title="title">
    <div class="body">
      <div class="message">
        <span class="message-icon" aria-hidden="true">
          <BaseIcon name="alert" :size="18" :stroke-width="2.5" />
        </span>
        <p class="message-text">{{ message }}</p>
      </div>
      <BaseOfflineNotice
        v-if="blockedOffline"
        variant="inline"
        :text="offlineHint ?? t('offline.actionHint')"
      />
      <p v-if="error" class="problem" role="alert"><BaseIcon name="alert" /> {{ error }}</p>
      <div class="buttons">
        <BaseButton variant="secondary" class="cancel" :disabled="loading" @click="open = false">
          {{ cancelLabel }}
        </BaseButton>
        <BaseButton
          variant="danger-solid"
          class="confirm"
          :loading="loading"
          :disabled="blockedOffline"
          @click="$emit('confirm')"
        >
          {{ confirmLabel }}
        </BaseButton>
      </div>
    </div>
  </BaseDialog>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* Design "verwalten-loeschen": warning sign on a red badge, the text in
   text color so it reads well on the red tint. */
.message {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: 0.875rem;
  border: var(--border-width-md) solid var(--color-danger);
  border-radius: var(--radius-lg);
  background: var(--color-danger-surface);
}

.message-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-full);
  background: var(--color-danger);
  color: var(--color-on-danger);
}

.message-text {
  min-width: 0;
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  line-height: 1.3125rem;
  overflow-wrap: anywhere;
}

.problem {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-danger-text);
  font-weight: var(--font-weight-bold);
}

.buttons {
  display: flex;
  gap: 0.625rem;
}

/* The extra room goes 1 : 1.3 like in the design. Growing from the text
   width (auto) and a smaller side padding keep a long label like
   "Endgültig löschen" on one line on a phone. */
.cancel,
.confirm {
  padding-inline: var(--space-3);
}

.cancel {
  flex: 1 1 auto;
}

.confirm {
  flex: 1.3 1 auto;
}
</style>
