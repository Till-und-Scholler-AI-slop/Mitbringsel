<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseSticker from '@/components/base/BaseSticker.vue'
import ContextCard from '@/components/list/ContextCard.vue'
import ItemForm from '@/components/list/ItemForm.vue'
import type { Item, List } from '@/types/api'

// The item form as a card of the context column (design
// "markt2-kontext-fhd-neu-hell", "...-details-dunkel"). Without `item` it
// adds new items and stays open after each one; with `item` it edits that
// item. Not modal: the list stays usable beside it, so the card handles
// Escape itself. focusOnMount: the user just opened it (not on page load).
const props = defineProps<{
  list: List
  item?: Item
  initialName?: string
  creatorName?: string | null
  focusOnMount?: boolean
}>()
// fromKeyboard: Delete was pressed with Enter or Space (see DoneSection).
const emit = defineEmits<{ close: []; remove: [fromKeyboard: boolean] }>()

const { t } = useI18n()
const form = ref<InstanceType<typeof ItemForm> | null>(null)

const title = computed(() => props.item?.name ?? t('list.itemForm.newTitle'))
// Where the item goes. While editing also who added it, until the card shows
// that in its own box (#178).
const tag = computed(() => {
  if (!props.item) return t('list.itemForm.newIn', { list: props.list.name })
  return props.creatorName
    ? t('list.itemForm.by', { name: props.creatorName, list: props.list.name })
    : t('list.itemForm.in', { list: props.list.name })
})

function focusName() {
  form.value?.focusName()
}

onMounted(() => {
  if (props.focusOnMount) focusName()
})
defineExpose({ focusName })
</script>

<template>
  <ContextCard :title="title" @keydown.esc="emit('close')">
    <template #tag>
      <span class="tag">
        <BaseSticker :icon="list.icon" :size="22" />
        {{ tag }}
      </span>
    </template>
    <ItemForm
      ref="form"
      :list-id="list.id"
      :list-name="list.name"
      :initial-name="initialName"
      :item="item"
      :creator-name="creatorName"
      hide-meta
      stay-after-add
      :autofocus="false"
      @close="emit('close')"
      @remove="emit('remove', $event)"
    />
  </ContextCard>
</template>

<style scoped>
.tag {
  display: flex;
  align-items: center;
  gap: var(--space-1-5);
  padding: 3px var(--space-3) 3px var(--space-1);
  border-radius: var(--radius-full);
  background: var(--color-qty-bg);
  color: var(--color-qty-text);
  font-size: var(--font-size-xs);
  line-height: 1.25rem;
  font-weight: var(--font-weight-heavy);
}
</style>
