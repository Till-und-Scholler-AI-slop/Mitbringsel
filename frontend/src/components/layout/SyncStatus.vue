<script setup lang="ts">
import BaseSyncIndicator from '@/components/base/BaseSyncIndicator.vue'
import { useItemsStore } from '@/stores/items'
import { useSyncStore } from '@/stores/sync'

/** The sync chip with the live connection and outbox state; nothing while signed out. */
withDefaults(defineProps<{ size?: 'md' | 'lg'; hint?: boolean; householdName?: string }>(), {
  size: 'md',
  hint: false,
})

const sync = useSyncStore()
const items = useItemsStore()
</script>

<template>
  <BaseSyncIndicator
    v-if="sync.indicator !== 'hidden'"
    :state="sync.indicator"
    :pending-count="items.pendingCount"
    :size="size"
    :hint="hint"
    :household-name="householdName"
  />
</template>
