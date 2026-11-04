<script setup lang="ts">
import BaseButton from '@/components/base/BaseButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'

// A question with a cancel and a dangerous confirm button. The parent runs
// the action on `confirm` and closes the dialog when it worked; a failure
// goes in `error` and the dialog stays open.
defineProps<{
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  loading?: boolean
  error?: string | null
}>()
defineEmits<{ confirm: [] }>()

const open = defineModel<boolean>('open', { required: true })
</script>

<template>
  <BaseDialog v-model:open="open" :title="title">
    <div class="body">
      <p class="message">{{ message }}</p>
      <p v-if="error" class="problem" role="alert"><BaseIcon name="alert" /> {{ error }}</p>
      <div class="buttons">
        <BaseButton variant="secondary" class="cancel" :disabled="loading" @click="open = false">
          {{ cancelLabel }}
        </BaseButton>
        <BaseButton variant="danger" class="confirm" :loading="loading" @click="$emit('confirm')">
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
  gap: var(--space-3);
}

.message {
  margin: 0;
  padding: var(--space-3);
  border: var(--border-width-md) solid var(--color-danger);
  border-radius: var(--radius-lg);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-weight: var(--font-weight-semibold);
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
  gap: var(--space-3);
}

.cancel {
  flex: 1;
}

.confirm {
  flex: 1.5;
}
</style>
