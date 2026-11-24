<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseButton from '@/components/base/BaseButton.vue'
import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSpinner from '@/components/base/BaseSpinner.vue'
import BaseSticker from '@/components/base/BaseSticker.vue'
import CompactItemRow from '@/components/list/CompactItemRow.vue'
import QuickAddBar from '@/components/list/QuickAddBar.vue'
import { useContextOverview } from '@/composables/useContextOverview'
import { useOpenCounts } from '@/composables/useOpenCounts'
import { useItemsStore } from '@/stores/items'

// The pinned list in the overview card (design
// "markt2-kontext-wqhd-zweite-hell"): its name and open count, an own
// quick-add bar and its open items. Adding and checking off go through the
// items store like in the list column, so they are sent by the outbox and
// live events keep the list current. Items are not edited from here.
const { t } = useI18n()
const items = useItemsStore()
const { openInList } = useOpenCounts()
const { pinnedList } = useContextOverview()

const quickAdd = ref<InstanceType<typeof QuickAddBar> | null>(null)

const listId = computed(() => pinnedList.value?.id ?? '')
const openItems = computed(() => items.openItems(listId.value))
const openCount = computed(() => openInList(listId.value))
const loading = computed(() => openCount.value === null && items.statusOf(listId.value) !== 'error')
const failed = computed(() => openCount.value === null && !loading.value)

function focusAdd() {
  quickAdd.value?.focus()
}
defineExpose({ focusAdd })
</script>

<template>
  <div v-if="pinnedList" class="panel">
    <div class="head">
      <BaseSticker :icon="pinnedList.icon" :size="44" />
      <h2 class="name">{{ pinnedList.name }}</h2>
      <span v-if="openCount !== null" class="count">
        {{ t('list.context.second.open', openCount) }}
      </span>
    </div>

    <QuickAddBar
      ref="quickAdd"
      compact
      :list-id="pinnedList.id"
      :label="t('list.context.second.add', { list: pinnedList.name })"
    />

    <p v-if="loading" class="notice" role="status"><BaseSpinner /> {{ t('list.items.loading') }}</p>
    <div v-else-if="failed" class="notice notice--failed" role="alert">
      <p>{{ t('list.items.loadFailed') }}</p>
      <BaseButton variant="secondary" @click="items.load(pinnedList.id)">
        <BaseIcon name="retry" /> {{ t('common.retry') }}
      </BaseButton>
    </div>
    <p v-else-if="openItems.length === 0" class="notice">{{ t('list.context.second.empty') }}</p>
    <ul v-else class="items" :aria-label="pinnedList.name">
      <CompactItemRow
        v-for="item in openItems"
        :key="item.id"
        :item="item"
        :pending="items.isPending(item.id)"
        @toggle="items.setChecked(item.id, true)"
      />
    </ul>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.head {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.name {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: var(--font-size-xl);
  line-height: 1.875rem;
  font-weight: var(--font-weight-display);
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

.count {
  flex: none;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
}

.items {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
  margin: 0;
  padding: 0;
  list-style: none;
}

.notice {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
}

.notice--failed {
  flex-direction: column;
  align-items: flex-start;
}

.notice--failed p {
  margin: 0;
}
</style>
