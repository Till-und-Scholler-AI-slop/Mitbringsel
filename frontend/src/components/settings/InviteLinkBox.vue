<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'

// How long "Copied" stays on the button.
const COPIED_MS = 2500

const props = defineProps<{ link: string; groupName: string }>()

const { t } = useI18n()

const copied = ref(false)
const copyFailed = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

// Only browsers with a share sheet (phones, Safari) can share; the others copy.
const canShare = typeof navigator.share === 'function'

// The link without "https://", which is how people read it.
const shown = computed(() => props.link.replace(/^https?:\/\//, ''))

onBeforeUnmount(() => clearTimeout(copiedTimer))

async function copy() {
  copyFailed.value = false
  try {
    await navigator.clipboard.writeText(props.link)
  } catch {
    // The browser may refuse (no permission, no secure context): the user
    // copies by hand, the link is selectable.
    copyFailed.value = true
    return
  }
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => (copied.value = false), COPIED_MS)
}

async function share() {
  try {
    await navigator.share({
      title: t('settings.invites.link.shareTitle', { name: props.groupName }),
      url: props.link,
    })
  } catch {
    // Closing the share sheet rejects too, and that is no error. Anything
    // else leaves the copy button, which always works.
  }
}
</script>

<template>
  <div class="box">
    <p class="link" :aria-label="t('settings.invites.link.label')">{{ shown }}</p>
    <div class="buttons">
      <BaseButton class="button" @click="copy">
        <BaseIcon :name="copied ? 'check' : 'copy'" :size="20" />
        {{ copied ? t('settings.invites.link.copied') : t('settings.invites.link.copy') }}
      </BaseButton>
      <BaseButton v-if="canShare" variant="secondary" class="button" @click="share">
        <BaseIcon name="share" :size="20" /> {{ t('settings.invites.link.share') }}
      </BaseButton>
    </div>
    <p v-if="copyFailed" class="problem" role="alert">
      <BaseIcon name="alert" /> {{ t('settings.invites.link.copyFailed') }}
    </p>
    <p class="only-now"><BaseIcon name="clock" /> {{ t('settings.invites.link.onlyNow') }}</p>
  </div>
</template>

<style scoped>
.box {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

/* One tap or click selects all of it, for copying by hand. */
.link {
  margin: 0;
  padding: var(--space-3) 0.875rem;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  line-height: 1.25rem;
  overflow-wrap: anywhere;
  user-select: all;
}

.buttons {
  display: flex;
  gap: 0.625rem;
}

.button {
  flex: 1;
  min-height: 3.5rem;
  font-size: 1.0625rem;
}

.problem {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-danger-text);
  font-weight: var(--font-weight-bold);
}

.only-now {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: 0.625rem var(--space-3);
  border-radius: 0.875rem;
  background: var(--color-bg);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  line-height: 1.1875rem;
}

.only-now :deep(svg) {
  flex: none;
}
</style>
