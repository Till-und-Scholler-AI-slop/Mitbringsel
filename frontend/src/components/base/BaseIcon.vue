<script setup lang="ts">
import { computed } from 'vue'

import { ICONS, type IconName } from './icons'

const DEFAULT_SIZE = 18
const DEFAULT_STROKE_WIDTH = 2.5

// Icons are decoration next to text, so screen readers skip them. A button
// that shows only an icon needs its own aria-label.
const props = withDefaults(defineProps<{ name: IconName; size?: number; strokeWidth?: number }>(), {
  size: DEFAULT_SIZE,
  strokeWidth: DEFAULT_STROKE_WIDTH,
})

const paths = computed(() => ICONS[props.name])
</script>

<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="d in paths" :key="d" :d="d" />
  </svg>
</template>
