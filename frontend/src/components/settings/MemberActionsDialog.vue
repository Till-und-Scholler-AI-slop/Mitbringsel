<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseAvatar from '@/components/base/BaseAvatar.vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import type { IconName } from '@/components/base/icons'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { ApiError, ERROR_CODE_UNKNOWN } from '@/services/api/client'
import { memberActions, type MemberAction } from '@/services/groupRoles'
import { useGroupsStore } from '@/stores/groups'
import type { Group, GroupMember } from '@/types/api'

const AVATAR_SIZE = 48

const ACTION_ICONS: Record<MemberAction, IconName> = {
  promote: 'shield',
  demote: 'user',
  remove: 'userX',
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
  <BaseDialog v-model:open="open" :title="t('settings.member.title')">
    <div class="body">
      <div class="who">
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
            <BaseIcon :name="ACTION_ICONS[action]" :size="20" />
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
          <BaseButton variant="secondary" class="back" @click="confirmingRemove = false">
            {{ t('settings.member.confirm.back') }}
          </BaseButton>
          <BaseButton variant="danger" class="remove" :loading="busy" @click="run('remove')">
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
  gap: var(--space-3);
}

.who {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.question {
  font-weight: var(--font-weight-bold);
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

.action {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--size-touch);
  padding: var(--space-3) var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
}

.action:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.action--danger {
  border-color: var(--color-danger);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.action-icon {
  flex: none;
  display: grid;
  place-items: center;
}

.action-text {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}

.action-title {
  font-weight: var(--font-weight-black);
}

.action-description {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  overflow-wrap: anywhere;
}

.confirm {
  margin: 0;
  padding: var(--space-3);
  border: var(--border-width-md) solid var(--color-danger);
  border-radius: var(--radius-lg);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
  font-weight: var(--font-weight-semibold);
  overflow-wrap: anywhere;
}

.buttons {
  display: flex;
  gap: var(--space-3);
}

.back {
  flex: 1;
}

.remove {
  flex: 1.5;
}
</style>
