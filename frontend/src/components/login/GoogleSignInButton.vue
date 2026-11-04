<script setup lang="ts">
import { useI18n } from 'vue-i18n'

// Follows Google's sign-in branding guidelines (pill shape, colors, logo),
// which is why it does not use BaseButton. Clicks reach the parent as a
// native click event.
withDefaults(defineProps<{ disabled?: boolean; busy?: boolean; label?: string }>(), {
  disabled: false,
  busy: false,
  label: undefined,
})

const { t } = useI18n()
</script>

<template>
  <button
    type="button"
    class="google-sign-in"
    :disabled="disabled || busy"
    :aria-busy="busy || undefined"
  >
    <svg class="logo" width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
    <span>{{ label ?? t('login.google') }}</span>
  </button>
</template>

<style scoped>
.google-sign-in {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  width: 100%;
  max-width: 25rem;
  min-height: var(--size-touch);
  padding: 0 var(--space-4);
  border: 1px solid var(--color-google-border);
  border-radius: var(--radius-full);
  background: var(--color-google-bg);
  color: var(--color-google-text);
  /* Roboto where installed (Android, many Linux setups). No web font: loading
     it from Google Fonts would send every visitor's IP address to Google. */
  font-family: Roboto, var(--font-sans);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
  line-height: 1.25;
  letter-spacing: 0.25px;
  cursor: pointer;
}

.google-sign-in:not(:disabled):hover {
  box-shadow: var(--shadow-google-hover);
}

.google-sign-in:disabled {
  border-color: var(--color-google-disabled-border);
  background: var(--color-google-disabled-bg);
  color: var(--color-google-disabled-text);
  cursor: not-allowed;
}

.logo {
  flex: none;
}

.google-sign-in:disabled .logo {
  opacity: 0.38;
}
</style>
