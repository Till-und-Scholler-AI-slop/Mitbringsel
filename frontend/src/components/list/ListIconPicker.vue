<script setup lang="ts">
import { useId } from 'vue'
import { useI18n } from 'vue-i18n'

import BaseSticker from '@/components/base/BaseSticker.vue'
import { LIST_ICON_GROUPS } from '@/services/listIcons'
import type { ListIcon } from '@/types/api'

// The icon of a list as a grid of sticker tiles. Exactly one is always
// picked, so the tiles are radio buttons: the browser brings arrow keys and
// "selected, 3 of 18" for screen readers. The input itself is hidden; the
// tile around it shows the state and the focus.
const model = defineModel<ListIcon>({ required: true })

const { t } = useI18n()
// All radios share one name, so the arrow keys run through every group.
const name = useId()
</script>

<template>
  <fieldset class="picker">
    <legend class="label">{{ t('list.icon.label') }}</legend>
    <div
      v-for="group in LIST_ICON_GROUPS"
      :key="group.key"
      class="group"
      role="group"
      :aria-labelledby="`${name}-${group.key}`"
    >
      <p :id="`${name}-${group.key}`" class="group-title">
        {{ t(`list.icon.groups.${group.key}`) }}
      </p>
      <div class="grid">
        <label
          v-for="icon in group.icons"
          :key="icon"
          :class="['tile', 'press-sticker', { 'tile--on': model === icon }]"
        >
          <input v-model="model" class="sr-only" type="radio" :name="name" :value="icon" />
          <BaseSticker :icon="icon" :size="52" />
          <span class="tile-name">{{ t(`list.icon.names.${icon}`) }}</span>
        </label>
      </div>
    </div>
  </fieldset>
</template>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.label {
  margin-bottom: var(--space-1-5);
  padding: 0;
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-heavy);
}

.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.group-title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.75rem;
  font-weight: var(--font-weight-black);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(5.25rem, 1fr));
  gap: var(--space-2);
}

/* A sticker tile like in the design: white with the sticker shadow, the
   picked one pressed in on a light tomato. */
.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-height: 6.5rem;
  padding: var(--space-2) var(--space-1);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sticker);
  color: var(--color-text);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.tile--on {
  background: var(--color-qty-bg);
  color: var(--color-qty-text);
  box-shadow: inset 0 3px 0 color-mix(in srgb, var(--color-on-accent) 12%, transparent);
  transform: translateY(3px);
}

/* The input is hidden, so the tile carries the focus ring. */
.tile:has(:focus-visible) {
  outline: var(--border-width-lg) solid var(--color-focus);
  outline-offset: 3px;
}

.tile-name {
  font-size: 0.8125rem;
  font-weight: var(--font-weight-heavy);
  line-height: 1.2;
  text-align: center;
  overflow-wrap: anywhere;
}
</style>
