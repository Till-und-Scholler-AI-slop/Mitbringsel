<script setup lang="ts">
import { computed } from 'vue'

const DEFAULT_SIZE = 22

// The turning arc takes the text color; put the spinner into an element
// with the color it should have.
const props = withDefaults(defineProps<{ size?: number }>(), { size: DEFAULT_SIZE })

const style = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }))
</script>

<template>
  <span class="spinner" :style="style" aria-hidden="true" />
</template>

<style scoped>
.spinner {
  flex: none;
  display: inline-block;
  border: var(--border-width-lg) solid var(--color-spinner-track);
  border-top-color: currentColor;
  border-radius: var(--radius-full);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Slower, not stopped: it still has to show that something is happening. */
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 2.4s;
  }
}
</style>
