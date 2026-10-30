<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { useLocale } from '@/composables/useLocale'
import { LOCALE_NAMES, SUPPORTED_LOCALES } from '@/i18n'

const { t } = useI18n()
const { locale, setLocale } = useLocale()
</script>

<template>
  <div class="language-switch" role="group" :aria-label="t('language.label')">
    <!-- The short code is what people see; the name in its own language is
         what screen readers announce, in that language. -->
    <button
      v-for="code in SUPPORTED_LOCALES"
      :key="code"
      type="button"
      class="option"
      :lang="code"
      :aria-label="LOCALE_NAMES[code]"
      :aria-pressed="locale === code"
      @click="setLocale(code)"
    >
      {{ code.toUpperCase() }}
    </button>
  </div>
</template>

<style scoped>
.language-switch {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: var(--border-width-sm) solid var(--color-text-muted);
  border-radius: var(--radius-full);
}

.option {
  min-width: 3.25rem;
  min-height: var(--size-touch);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-black);
  cursor: pointer;
}

.option[aria-pressed='true'] {
  background: var(--color-selected-bg);
  color: var(--color-selected-text);
}
</style>
