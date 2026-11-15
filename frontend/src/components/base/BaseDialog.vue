<script setup lang="ts">
import { onMounted, useId, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseIconButton from './BaseIconButton.vue'

// Bottom sheet on the phone, centered dialog from 48rem on. It is a native
// <dialog>: the browser keeps the focus inside, makes everything behind it
// inert and closes it on Escape.
defineProps<{ title: string }>()

// The parent decides when it is open; every way of closing (close button,
// Escape, click on the dimmed area) sets this back to false.
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const dialog = useTemplateRef<HTMLDialogElement>('dialog')
const titleId = useId()

// Makes the native element match `open`.
function sync() {
  const element = dialog.value
  if (!element) return
  if (open.value && !element.open) {
    element.showModal()
  } else if (!open.value && element.open) {
    element.close()
  }
}

onMounted(sync)
watch(open, sync, { flush: 'post' })

// Fires after close() and after Escape, so it is the one place that
// reports the closing to the parent.
function onClose() {
  open.value = false
}
</script>

<template>
  <!-- The <dialog> fills the viewport and is the dimmed area itself: a click
       on it (and not on the panel inside) closes. This avoids ::backdrop,
       which cannot read the theme variables in every browser. -->
  <dialog
    ref="dialog"
    class="dialog"
    :aria-labelledby="titleId"
    @close="onClose"
    @click.self="dialog?.close()"
  >
    <div class="panel">
      <span class="handle" aria-hidden="true" />
      <header class="header">
        <div class="heading">
          <h2 :id="titleId" class="title">{{ title }}</h2>
          <!-- e.g. the role chip under a member's name -->
          <slot name="subtitle" />
        </div>
        <BaseIconButton icon="close" :label="t('common.close')" @click="dialog?.close()" />
      </header>
      <slot />
    </div>
  </dialog>
</template>

<style scoped>
.dialog {
  width: 100%;
  max-width: none;
  height: 100%;
  max-height: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: var(--color-scrim);
  color: var(--color-text);
}

/* display only while open: setting it on .dialog would show a closed one. */
.dialog[open] {
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  max-height: 100%;
  overflow-y: auto;
  padding: var(--space-4) var(--space-4) var(--space-6);
  border: var(--border-width-lg) solid var(--color-border);
  border-bottom-width: 0;
  border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
  background: var(--color-surface);
}

.handle {
  align-self: center;
  width: 2.75rem;
  height: 0.375rem;
  border-radius: var(--radius-full);
  background: var(--color-border);
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-2);
}

.title {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-black);
  line-height: var(--line-height-heading);
  letter-spacing: -0.02em;
  overflow-wrap: break-word;
}

@media (min-width: 48rem) {
  .dialog[open] {
    align-items: center;
    padding: var(--space-6);
  }

  .panel {
    max-width: 30rem;
    padding-bottom: var(--space-4);
    border-bottom-width: var(--border-width-lg);
    border-radius: var(--radius-2xl);
  }

  .handle {
    display: none;
  }
}
</style>
