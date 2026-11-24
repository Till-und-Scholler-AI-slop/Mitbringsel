<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseEmptyState from '@/components/base/BaseEmptyState.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseOfflineNotice from '@/components/base/BaseOfflineNotice.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import GroupInvitesSection from '@/components/settings/GroupInvitesSection.vue'
import GroupDangerSection from '@/components/settings/GroupDangerSection.vue'
import MemberActionsDialog from '@/components/settings/MemberActionsDialog.vue'
import MemberRow from '@/components/settings/MemberRow.vue'
import RenameGroupDialog from '@/components/settings/RenameGroupDialog.vue'
import SettingsCard from '@/components/settings/SettingsCard.vue'
import SyncStatus from '@/components/layout/SyncStatus.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { useLeaveRemovedGroup } from '@/composables/useLeaveRemovedGroup'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { canManage, memberActions, sortMembers } from '@/services/groupRoles'
import { useAuthStore } from '@/stores/auth'
import { useGroupsStore } from '@/stores/groups'
import type { Role } from '@/types/api'

type ViewState = 'loading' | 'failed' | 'missing' | 'ready'

const props = defineProps<{ groupId: string }>()

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const groups = useGroupsStore()
const { online } = useOnlineStatus()
const loadError = useErrorMessage(() => groups.errorCode)

const renameOpen = ref(false)
// The member whose actions are open; looked up again so a member who is gone closes the dialog.
const selectedId = ref<string | null>(null)

const group = computed(() => groups.byId(props.groupId))
const isManager = computed(() => group.value !== undefined && canManage(group.value.role))

const members = computed(() => sortMembers(group.value?.members ?? []))
const selected = computed(() => members.value.find((m) => m.userId === selectedId.value))

function canAct(userId: string, role: Role): boolean {
  if (!group.value || userId === auth.user?.id) return false
  return memberActions(group.value.role, role).length > 0
}

// A group that is in the store is shown, even if the last reload failed.
// "missing": the groups loaded, and this one is not among them.
const state = computed<ViewState>(() => {
  if (group.value) return 'ready'
  if (groups.status === 'error') return 'failed'
  return groups.status === 'ready' ? 'missing' : 'loading'
})

// Coming from the start page the groups are there already; a direct visit
// of the URL has to load them first.
onMounted(() => {
  if (groups.status === 'idle') groups.load()
})

// The load that failed offline is repeated once the connection is back.
watch(online, (isOnline) => {
  if (isOnline && groups.status === 'error') {
    groups.load()
  }
})

useLeaveRemovedGroup(() => props.groupId)

function goHome() {
  return router.push({ name: 'home' })
}

function goBack() {
  return router.push({ name: 'group', params: { groupId: props.groupId } })
}
</script>

<template>
  <div class="settings">
    <header class="bar">
      <div class="bar-inner">
        <div class="top">
          <button type="button" class="back" :aria-label="t('settings.back')" @click="goBack">
            <BaseIcon name="arrowLeft" :size="24" :stroke-width="2.75" />
          </button>
          <SyncStatus />
        </div>
        <h1 class="title">{{ t('settings.title') }}</h1>
      </div>
    </header>

    <main class="content">
      <p v-if="state === 'loading'" class="loading" role="status">
        <BaseSpinner /> {{ t('settings.loading') }}
      </p>

      <div v-else-if="state === 'failed'" class="failed" role="alert">
        <p class="failed-title">{{ t('settings.loadFailed') }}</p>
        <p>{{ loadError }}</p>
        <BaseButton variant="secondary" @click="groups.load()">
          <BaseIcon name="retry" /> {{ t('common.retry') }}
        </BaseButton>
      </div>

      <BaseEmptyState
        v-else-if="state === 'missing'"
        :title="t('settings.missing.title')"
        :description="t('settings.missing.description')"
      >
        <template #icon><BaseIcon name="linkOff" :size="24" /></template>
        <BaseButton @click="goHome">{{ t('settings.missing.home') }}</BaseButton>
      </BaseEmptyState>

      <template v-else-if="group">
        <BaseOfflineNotice v-if="!online" :text="t('settings.offline')" />

        <!-- Two columns side by side on a wide screen (design
             "verwalten-desktop-*"), one below the other on a phone. The
             order in the DOM is the reading order in both. -->
        <div class="columns">
          <div class="column">
            <SettingsCard class="name-card" :title="t('settings.name.title')">
              <template #aside>
                <button
                  v-if="isManager"
                  type="button"
                  class="rename"
                  aria-haspopup="dialog"
                  :disabled="!online"
                  @click="renameOpen = true"
                >
                  <BaseIcon name="pencil" :size="18" /> {{ t('settings.name.rename') }}
                </button>
              </template>
              <div class="name-row">
                <span class="name-icon" aria-hidden="true"
                  ><BaseIcon name="home" :size="22"
                /></span>
                <p class="name">{{ group.name }}</p>
              </div>
            </SettingsCard>

            <SettingsCard class="members-card" :title="t('settings.members.title')">
              <template #aside>
                <span
                  class="count"
                  role="img"
                  :aria-label="t('settings.members.count', members.length)"
                >
                  {{ members.length }}
                </span>
              </template>
              <ul class="members">
                <MemberRow
                  v-for="member in members"
                  :key="member.userId"
                  :member="member"
                  :is-me="member.userId === auth.user?.id"
                  :can-act="canAct(member.userId, member.role)"
                  :offline="!online"
                  @act="selectedId = member.userId"
                />
              </ul>
              <p class="explain">{{ t('settings.members.explain') }}</p>
            </SettingsCard>
          </div>
          <div class="column">
            <GroupInvitesSection v-if="isManager" :group="group" />

            <GroupDangerSection :group="group" />
          </div>
        </div>

        <RenameGroupDialog v-model:open="renameOpen" :group="group" />
        <MemberActionsDialog
          v-if="selected"
          :open="true"
          :group="group"
          :member="selected"
          @update:open="selectedId = null"
        />
      </template>
    </main>
  </div>
</template>

<style scoped>
.settings {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

.bar {
  padding: 0.625rem var(--space-4) 1.375rem;
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.bar-inner {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.625rem;
  width: 100%;
  max-width: 68rem;
  margin: 0 auto;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  align-self: stretch;
}

/* White in both themes, like the header it sits on. */
.back {
  display: grid;
  place-items: center;
  width: var(--size-touch);
  height: var(--size-touch);
  padding: 0;
  border: var(--border-width-md) solid var(--color-on-accent);
  border-radius: var(--radius-full);
  background: var(--color-accent-white);
  color: var(--color-on-accent);
  cursor: pointer;
}

.title {
  margin: 0;
  padding-left: var(--space-1);
  font-size: 1.875rem;
  font-weight: var(--font-weight-black);
  line-height: 2.125rem;
  letter-spacing: -0.03em;
  overflow-wrap: break-word;
}

.content {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  max-width: 40rem;
  margin: 0 auto;
  padding: 1.125rem var(--space-4) var(--space-8);
}

.columns,
.column {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.column {
  min-width: 0;
}

.loading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  color: var(--color-text-muted);
}

.failed {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--border-width-md) solid var(--color-danger);
  border-radius: var(--radius-lg);
  background: var(--color-danger-surface);
  color: var(--color-danger-text);
}

.failed p {
  margin: 0;
}

.failed-title {
  font-weight: var(--font-weight-black);
}

.rename {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  min-height: 2.75rem;
  padding: 0 0.875rem;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-heavy);
}

.name-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.name-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-full);
  background: var(--color-house-bg);
  color: var(--color-house-text);
}

.name {
  min-width: 0;
  margin: 0;
  font-size: 1.6875rem;
  font-weight: var(--font-weight-display);
  line-height: 2rem;
  letter-spacing: -0.025em;
  overflow-wrap: anywhere;
}

/* The rows bring their own inner space; the card keeps less. */
.members-card {
  padding-inline: var(--space-3);
}

.members-card :deep(.head) {
  padding-inline: var(--space-1-5);
}

.count {
  flex: none;
  display: grid;
  place-items: center;
  min-width: 1.5rem;
  height: 1.5rem;
  box-sizing: border-box;
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  /* Ink and tomato in both themes, as in the design. */
  background: var(--color-on-accent);
  color: var(--color-accent-tomato);
  font-size: 0.8125rem;
  font-weight: var(--font-weight-heavy);
}

.members {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  margin: 0;
  padding: 0;
  list-style: none;
}

.explain {
  margin: 2px var(--space-1-5) 0;
  color: var(--color-text-muted);
  font-size: 0.8125rem;
  font-weight: var(--font-weight-medium);
  line-height: 1.125rem;
}

/* Desktop (design "verwalten-desktop-*"): a roomier header and two columns.
   Each column starts at 460 px and they share the rest; when two do not
   fit (up to about 1030 px), the second wraps below the first. */
@media (min-width: 48rem) {
  .bar {
    padding: var(--space-6) var(--space-12) 2.25rem;
  }

  .title {
    font-size: 2.75rem;
    line-height: 3.125rem;
  }

  .content {
    max-width: 74rem;
    padding: var(--space-8) var(--space-12) 3.5rem;
  }

  .columns {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .column {
    flex: 1 1 28.75rem;
  }
}
</style>
