<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseEmptyState from '@/components/base/BaseEmptyState.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import CreateGroupDialog from '@/components/start/CreateGroupDialog.vue'
import GroupCard from '@/components/start/GroupCard.vue'
import ProfileMenu from '@/components/start/ProfileMenu.vue'
import { useErrorMessage } from '@/composables/useErrorMessage'
import { useOnlineStatus } from '@/composables/useOnlineStatus'
import { useAuthStore } from '@/stores/auth'
import { useGroupsStore } from '@/stores/groups'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const groups = useGroupsStore()
const { online } = useOnlineStatus()
const loadError = useErrorMessage(() => groups.errorCode)

const createOpen = ref(false)

// "Hallo Lena": the first word of the display name.
const firstName = computed(() => auth.user?.displayName.trim().split(/\s+/)[0] ?? '')

const loading = computed(() => groups.status === 'loading' && groups.groups.length === 0)
const failed = computed(() => groups.status === 'error' && groups.groups.length === 0)
const empty = computed(() => groups.status === 'ready' && groups.groups.length === 0)

async function logout() {
  try {
    await auth.logout()
  } finally {
    // The store is logged out even if the request failed, so leave anyway.
    await router.push({ name: 'login' })
  }
}

onMounted(() => groups.load())

// The load that failed offline is repeated once the connection is back.
watch(online, (isOnline) => {
  if (isOnline && groups.status === 'error') {
    groups.load()
  }
})
</script>

<template>
  <div class="start">
    <header class="bar">
      <span class="logo">{{ t('app.name') }}</span>
      <ProfileMenu
        v-if="auth.user"
        :name="auth.user.displayName"
        :avatar-url="auth.user.avatarUrl"
        @logout="logout"
      />
    </header>

    <main class="content">
      <h1 v-if="firstName" class="greeting">{{ t('start.greeting', { name: firstName }) }}</h1>

      <p v-if="!online" class="offline" role="status">
        <span class="offline-badge"
          ><BaseIcon name="cloudOff" /> {{ t('start.offline.badge') }}</span
        >
        {{ t('start.offline.body') }}
      </p>

      <section class="groups" aria-labelledby="groups-title">
        <h2 id="groups-title" class="section-title">{{ t('start.groups.title') }}</h2>

        <p v-if="loading" class="loading" role="status">
          <BaseSpinner /> {{ t('start.groups.loading') }}
        </p>

        <div v-else-if="failed" class="failed" role="alert">
          <p class="failed-title">{{ t('start.groups.loadFailed') }}</p>
          <p>{{ loadError }}</p>
          <BaseButton variant="secondary" @click="groups.load()">
            <BaseIcon name="retry" /> {{ t('common.retry') }}
          </BaseButton>
        </div>

        <BaseEmptyState
          v-else-if="empty"
          :title="t('start.empty.title')"
          :description="t('start.empty.description')"
        >
          <template #icon><BaseIcon name="home" :size="24" /></template>
          <BaseButton @click="createOpen = true">
            <BaseIcon name="plus" /> {{ t('start.create.open') }}
          </BaseButton>
        </BaseEmptyState>

        <template v-else>
          <ul class="cards">
            <li v-for="group in groups.groups" :key="group.id">
              <GroupCard :group="group" />
            </li>
          </ul>
          <div class="create-box">
            <BaseButton @click="createOpen = true">
              <BaseIcon name="plus" /> {{ t('start.create.open') }}
            </BaseButton>
          </div>
        </template>
      </section>
    </main>

    <CreateGroupDialog v-model:open="createOpen" />
  </div>
</template>

<style scoped>
.start {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4) var(--space-4) var(--space-5);
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

.logo {
  display: inline-block;
  padding: var(--space-1-5) var(--space-4);
  border-radius: var(--radius-full);
  background: var(--color-accent-tomato);
  color: var(--color-on-accent);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-tight);
  letter-spacing: -0.01em;
  box-shadow: var(--shadow-sticker);
  transform: rotate(-3deg);
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: 56rem;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4) var(--space-8);
}

.greeting {
  margin: 0;
  font-size: var(--font-size-2xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-heading);
  letter-spacing: -0.03em;
  overflow-wrap: break-word;
}

.offline {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border: var(--border-width-md) dashed var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  font-weight: var(--font-weight-semibold);
}

.offline-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1-5) var(--space-3);
  border-radius: var(--radius-full);
  background: var(--color-offline-bg);
  color: var(--color-offline-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
}

.groups {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.section-title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-heading);
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
  gap: var(--space-2);
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

/* minmax(0, 1fr), not the default auto column: an auto column is at least as
   wide as its widest content, so a long household name (which does not wrap)
   would push the cards out of the screen on a phone. */
.cards {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

.create-box {
  display: flex;
  flex-direction: column;
  padding: var(--space-3);
  border: var(--border-width-md) dashed var(--color-text-muted);
  border-radius: var(--radius-lg);
}

@media (min-width: 48rem) {
  .cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .create-box {
    align-self: flex-start;
  }
}
</style>
