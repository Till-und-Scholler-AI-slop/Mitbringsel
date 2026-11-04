<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseEmptyState from '@/components/base/BaseEmptyState.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseIconButton from '@/components/base/BaseIconButton.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import RenameGroupDialog from '@/components/settings/RenameGroupDialog.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { canManage } from '@/services/groupRoles'
import { useGroupsStore } from '@/stores/groups'

type ViewState = 'loading' | 'failed' | 'missing' | 'ready'

const props = defineProps<{ groupId: string }>()

const { t } = useI18n()
const router = useRouter()
const groups = useGroupsStore()
const loadError = useErrorMessage(() => groups.errorCode)

const renameOpen = ref(false)

const group = computed(() => groups.byId(props.groupId))
const canRename = computed(() => group.value !== undefined && canManage(group.value.role))

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

function goHome() {
  return router.push({ name: 'home' })
}
</script>

<template>
  <div class="settings">
    <header class="bar">
      <BaseIconButton icon="arrowLeft" :label="t('settings.back')" @click="goHome" />
      <h1 class="title">{{ t('settings.title') }}</h1>
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
        <section class="section" aria-labelledby="name-title">
          <div class="section-head">
            <h2 id="name-title" class="section-title">{{ t('settings.name.title') }}</h2>
            <BaseButton v-if="canRename" variant="secondary" @click="renameOpen = true">
              <BaseIcon name="pencil" /> {{ t('settings.name.rename') }}
            </BaseButton>
          </div>
          <div class="name-card">
            <span class="name-icon" aria-hidden="true"><BaseIcon name="home" :size="22" /></span>
            <p class="name">{{ group.name }}</p>
          </div>
        </section>

        <RenameGroupDialog v-model:open="renameOpen" :group="group" />
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
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4) var(--space-6);
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
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  width: 100%;
  max-width: 40rem;
  margin: 0 auto;
  padding: var(--space-5) var(--space-4) var(--space-8);
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

.section {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.section-title {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-black);
}

.name-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sticker);
}

.name-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: var(--radius-full);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.name {
  min-width: 0;
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-heading);
  overflow-wrap: anywhere;
}
</style>
