<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'
import BaseSticker from '@/components/base/BaseSticker.vue'
import ContextCard from '@/components/list/ContextCard.vue'
import ItemForm from '@/components/list/ItemForm.vue'
import type { Item, List } from '@/types/api'

// The item form as a card of the context column (design
// "markt2-kontext-fhd-neu-hell", "...-details-dunkel"). Without `item` it
// adds new items and stays open after each one; with `item` it edits that
// item. Not modal: the list stays usable beside it, so the card handles
// Escape itself. focusOnMount: the user just opened it (not on page load).
// collapsed: the card is a bar while the overview card above it is open.
// collapsible: it has a button that collapses it (there is an overview).
const props = defineProps<{
  list: List
  item?: Item
  initialName?: string
  creatorName?: string | null
  focusOnMount?: boolean
  collapsed?: boolean
  collapsible?: boolean
}>()
// fromKeyboard: Delete was pressed with Enter or Space (see DoneSection).
const emit = defineEmits<{
  close: []
  remove: [fromKeyboard: boolean]
  expand: []
  collapse: []
}>()

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

const editing = computed(() => props.item !== undefined)
const barTitle = computed(() =>
  props.item
    ? t('list.context.form.barTitleEdit', { name: props.item.name })
    : t('list.itemForm.newTitle'),
)
const barSummary = computed(() =>
  props.item
    ? t('list.itemForm.in', { list: props.list.name })
    : t('list.context.form.barSummaryNew', { list: props.list.name }),
)

function focusName() {
  form.value?.focusName()
}

onMounted(() => {
  if (props.focusOnMount) focusName()
})
defineExpose({ focusName })
</script>

<template>
  <ContextCard
    :label="t(editing ? 'list.context.form.labelEdit' : 'list.context.form.labelNew')"
    :collapsed="collapsed"
    :collapsible="collapsible"
    :collapse-label="
      t(editing ? 'list.context.form.collapseEdit' : 'list.context.form.collapseNew')
    "
    :bar-title="barTitle"
    :bar-summary="barSummary"
    bar-chevron="up"
    @keydown.esc="emit('close')"
    @expand="emit('expand')"
    @collapse="emit('collapse')"
  >
    <template #bar-icon>
      <span class="bar-icon" aria-hidden="true">
        <BaseIcon :name="editing ? 'pencil' : 'plus'" :size="22" :stroke-width="2.75" />
      </span>
    </template>
    <template #head>
      <h2 class="title">{{ title }}</h2>
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
.title {
  max-width: 100%;
  margin: 0;
  font-size: 1.6875rem;
  line-height: 2rem;
  font-weight: var(--font-weight-display);
  letter-spacing: -0.025em;
  overflow-wrap: break-word;
}

.bar-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border: var(--border-width-sm) solid var(--color-on-accent);
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: var(--color-on-accent);
}

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
