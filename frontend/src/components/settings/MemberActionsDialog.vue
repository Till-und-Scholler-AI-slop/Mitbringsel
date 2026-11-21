<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import type { IconName } from '@/components/base/icons'
import MemberRoleChip from '@/components/settings/MemberRoleChip.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { memberActions, type MemberAction } from '@/services/groupRoles'
import { useGroupsStore } from '@/stores/groups'
import type { Group, GroupMember } from '@/types/api'

const AVATAR_SIZE = 48

const ACTION_ICONS: Record<MemberAction, IconName> = {
  promote: 'shield',
  demote: 'user',
  remove: 'userMinus',
}

// The parent renders this dialog only while a member is selected, so every
// opening starts on the list of actions without an old error.
const props = defineProps<{ group: Group; member: GroupMember }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const groups = useGroupsStore()

// Removing a person needs a second look; the other actions run right away.
const confirmingRemove = ref(false)
const busy = ref(false)
const errorCode = ref<string | null>(null)
const errorMessage = useErrorMessage(errorCode)

const actions = computed(() => memberActions(props.group.role, props.member.role))

async function run(action: MemberAction) {
  if (action === 'remove' && !confirmingRemove.value) {
    confirmingRemove.value = true
    return
  }
  busy.value = true
  errorCode.value = null
  try {
    if (action === 'remove') {
      await groups.removeMember(props.group.id, props.member.userId)
    } else {
      await groups.setMemberRole(
        props.group.id,
        props.member.userId,
        action === 'promote' ? 'admin' : 'member',
      )
    }
    open.value = false
  } catch (err) {
    errorCode.value = err instanceof ApiError ? err.code : ERROR_CODE_UNKNOWN
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <!-- Named after the person, with their role below (design "verwalten-aktionen"). -->
  <BaseDialog v-model:open="open" :title="member.displayName">
    <template #subtitle><MemberRoleChip :role="member.role" /></template>
    <div class="body">
      <div v-if="!confirmingRemove" class="who">
        <BaseAvatar :name="member.displayName" :src="member.avatarUrl" :size="AVATAR_SIZE" />
        <span class="question">
          {{ t('settings.member.question', { name: member.displayName }) }}
        </span>
      </div>

      <p v-if="errorCode" class="problem" role="alert">
        <BaseIcon name="alert" /> {{ errorMessage }}
      </p>

      <template v-if="!confirmingRemove">
        <button
          v-for="action in actions"
          :key="action"
          type="button"
          :class="['action', { 'action--danger': action === 'remove' }]"
          :disabled="busy"
          @click="run(action)"
        >
          <span class="action-icon" aria-hidden="true">
            <BaseIcon :name="ACTION_ICONS[action]" :size="20" :stroke-width="2.5" />
          </span>
          <span class="action-text">
            <span class="action-title">{{ t(`settings.member.${action}.title`) }}</span>
            <span class="action-description">
              {{ t(`settings.member.${action}.description`, { name: member.displayName }) }}
            </span>
          </span>
        </button>
      </template>

      <template v-else>
        <p class="confirm">
          {{ t('settings.member.confirm.body', { name: member.displayName, group: group.name }) }}
        </p>
        <div class="buttons">
          <BaseButton
            variant="secondary"
            class="back"
            :disabled="busy"
            @click="confirmingRemove = false"
          >
            {{ t('settings.member.confirm.back') }}
          </BaseButton>
          <BaseButton variant="danger-solid" class="remove" :loading="busy" @click="run('remove')">
            {{ t('settings.member.confirm.remove') }}
          </BaseButton>
        </div>
      </template>
    </div>
  </BaseDialog>
</template>

<style scoped>
.body {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.who {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding-bottom: var(--space-1);
}

.question {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
  line-height: 1.25rem;
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

/* One card per action: icon on a round badge, title, what it does. */
.action {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 4rem;
  padding: var(--space-2) 0.875rem var(--space-2) 0.625rem;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.action:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.action-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.625rem;
  height: 2.625rem;
  border-radius: var(--radius-full);
  background: var(--color-muted-bg);
  color: var(--color-text);
}

.action-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.action-title {
  font-size: 1.0625rem;
  font-weight: var(--font-weight-black);
  line-height: 1.375rem;
}

.action-description {
  color: var(--color-text-muted);
  font-size: 0.875rem;
  font-weight: var(--font-weight-medium);
  line-height: 1.1875rem;
  overflow-wrap: anywhere;
}

/* Removing: red card, white icon on red, the description in text color. */
.action--danger {
  border-color: var(--color-danger);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.action--danger .action-icon {
  background: var(--color-danger);
  color: var(--color-on-danger);
}

.action--danger .action-description {
  color: var(--color-text);
}

.confirm {
  margin: 0 0 0.375rem;
  padding: 0.875rem;
  border: var(--border-width-md) solid var(--color-danger);
  border-radius: var(--radius-lg);
  background: var(--color-danger-surface);
  color: var(--color-text);
  font-size: 0.9375rem;
  font-weight: var(--font-weight-semibold);
  line-height: 1.3125rem;
  overflow-wrap: anywhere;
}

.buttons {
  display: flex;
  gap: 0.625rem;
}

/* The extra room goes 1 : 1.3 like in the design. Growing from the text
   width (auto) and a smaller side padding keep a long label like
   "Endgültig löschen" on one line on a phone. */
.back,
.remove {
  padding-inline: var(--space-3);
}

.back {
  flex: 1 1 auto;
}

.remove {
  flex: 1.3 1 auto;
}
</style>
