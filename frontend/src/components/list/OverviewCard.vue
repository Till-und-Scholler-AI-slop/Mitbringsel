<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseSticker from '@/components/base/BaseSticker.vue'
import ContextCard from '@/components/list/ContextCard.vue'
import SecondListChips from '@/components/list/SecondListChips.vue'
import SecondListPanel from '@/components/list/SecondListPanel.vue'
import { useContextOverview } from '@/composables/useContextOverview'
import { useOpenCounts } from '@/composables/useOpenCounts'
import { useItemsStore } from '@/stores/items'

// The top card of the context column: the second list, pinned beside the
// open one (design "markt2-kontext-wqhd-zweite-hell"). Until the activity
// tab comes (#185) it shows the second list directly, without tabs.
// collapsed: the form card below is open, this one is a bar.
defineProps<{ collapsed: boolean }>()
defineEmits<{ expand: []; collapse: [] }>()

const { t } = useI18n()
const items = useItemsStore()
const { openInList } = useOpenCounts()
const { pinnedList } = useContextOverview()

const panel = ref<InstanceType<typeof SecondListPanel> | null>(null)

// "3 open · latest Brötchen": how many are open and what was added last.
const summary = computed(() => {
  const list = pinnedList.value
  if (!list) return ''
  const count = openInList(list.id)
  const open = count === null ? '' : t('list.context.second.open', count)
  const openItems = items.openItems(list.id)
  const latest = openItems[openItems.length - 1]
  return latest && open ? t('list.context.second.summary', { open, name: latest.name }) : open
})

// The focus goes to the quick-add bar of the pinned list when the card opens.
defineExpose({ focusStart: () => panel.value?.focusAdd() })
</script>

<template>
  <ContextCard
    v-if="pinnedList"
    :label="t('list.context.overview.label', { name: pinnedList.name })"
    :collapsed="collapsed"
    collapsible
    :collapse-label="t('list.context.overview.collapse')"
    :bar-title="pinnedList.name"
    :bar-summary="summary"
    bar-chevron="down"
    @expand="$emit('expand')"
    @collapse="$emit('collapse')"
  >
    <template #bar-icon><BaseSticker :icon="pinnedList.icon" :size="48" /></template>
    <template #head><SecondListChips /></template>
    <SecondListPanel ref="panel" />
  </ContextCard>
</template>
