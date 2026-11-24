<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseOfflineNotice from '@/components/base/BaseOfflineNotice.vue'
import { useOnlineStatus } from '@/composables/useOnlineStatus'

const AVATAR_SIZE = 40
const ROW_AVATAR_SIZE = 34

// row: the profile at the bottom of the desktop sidebar, with the name next
// to the avatar; its panel opens upwards.
withDefaults(defineProps<{ name: string; avatarUrl: string | null; row?: boolean }>(), {
  row: false,
})
const emit = defineEmits<{ logout: [] }>()

const { t } = useI18n()
const { online } = useOnlineStatus()
const root = useTemplateRef<HTMLElement>('root')
const toggle = useTemplateRef<HTMLButtonElement>('toggle')
const panelId = useId()
const open = ref(false)

function close() {
  open.value = false
}

// A disclosure, not role="menu": a menu promises arrow-key navigation,
// which one button does not need.
function onEscape() {
  if (open.value) {
    close()
    toggle.value?.focus()
  }
}

// A press anywhere outside closes the panel.
function onPointerDown(event: PointerEvent) {
  if (open.value && event.target instanceof Node && !root.value?.contains(event.target)) {
    close()
  }
}

function logout() {
  if (!online.value) return
  close()
  emit('logout')
}

onMounted(() => document.addEventListener('pointerdown', onPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown))
</script>

<template>
  <div ref="root" :class="['profile', { 'profile--row': row }]" @keydown.esc="onEscape">
    <!-- The row shows the name, so it is the button's name too. -->
    <button
      ref="toggle"
      type="button"
      class="toggle"
      :aria-label="row ? undefined : t('start.profile.label', { name })"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="open = !open"
    >
      <BaseAvatar
        class="avatar"
        :name="name"
        :src="avatarUrl"
        :size="row ? ROW_AVATAR_SIZE : AVATAR_SIZE"
      />
      <span v-if="row" class="row-text">
        <span class="row-name">{{ name }}</span>
        <span class="row-you">{{ t('start.profile.you') }}</span>
      </span>
    </button>

    <div v-if="open" :id="panelId" class="panel">
      <p class="name">{{ name }}</p>
      <BaseButton variant="secondary" :disabled="!online" @click="logout">
        <BaseIcon name="logOut" />
        {{ t('start.profile.logout') }}
      </BaseButton>
      <BaseOfflineNotice v-if="!online" variant="inline" :text="t('offline.logoutHint')" />
    </div>
  </div>
</template>

<style scoped>
.profile {
  position: relative;
}

.toggle {
  display: grid;
  place-items: center;
  width: var(--size-touch);
  height: var(--size-touch);
  padding: 0;
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  cursor: pointer;
}

.avatar {
  box-shadow: 0 0 0 var(--border-width-md) var(--color-on-brand);
}

.panel {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 14rem;
  max-width: min(17rem, calc(100vw - 2 * var(--space-4)));
  padding: var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text);
  box-shadow: var(--shadow-sticker);
}

.profile--row .toggle {
  width: 100%;
  height: auto;
  min-height: var(--size-touch);
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: var(--space-1);
  border-radius: var(--radius-md);
  color: var(--color-on-brand);
  text-align: left;
}

.profile--row .avatar {
  flex: none;
  box-shadow: none;
}

.row-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.row-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-heavy);
  overflow-wrap: anywhere;
}

.row-you {
  font-size: 0.8125rem;
  font-weight: var(--font-weight-medium);
}

.profile--row .panel {
  top: auto;
  right: 0;
  bottom: calc(100% + var(--space-2));
  left: 0;
  min-width: 0;
}

.name {
  margin: 0;
  font-weight: var(--font-weight-black);
  overflow-wrap: break-word;
}
</style>
