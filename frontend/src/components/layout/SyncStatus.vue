<script setup lang="ts">
import BaseSyncIndicator from '@/components/base/BaseSyncIndicator.vue'
import { useSyncStore } from '@/stores/sync'

/** The sync chip with the state of the live connection; nothing while signed out. */
withDefaults(defineProps<{ size?: 'md' | 'lg'; hint?: boolean }>(), {
  size: 'md',
  hint: false,
})

const sync = useSyncStore()
</script>

<template>
  <BaseSyncIndicator
    v-if="sync.indicator !== 'hidden'"
    :state="sync.indicator"
    :size="size"
    :hint="hint"
  />
</template>
