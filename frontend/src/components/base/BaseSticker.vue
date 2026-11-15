<script setup lang="ts">
import { computed } from 'vue'

import type { ListIcon } from '@/types/api'

import { STICKERS } from './stickers'

// How much wider than the outline the white cut border reaches, and how far
// the shadow sits below it, in grid units (design: "Kontur + 5,5", "2,5
// nach unten").
const CUT = 5.5
const SHADOW_OFFSET = 2.5

// A list icon as a die-cut sticker: the illustration on a white cut border
// with a hard shadow, slightly askew. Decoration next to the list's name, so
// screen readers skip it. Below about 32 px the border eats the details.
const props = withDefaults(defineProps<{ icon: ListIcon; size?: number }>(), { size: 46 })

const sticker = computed(() => STICKERS[props.icon])
</script>

<template>
  <svg
    class="sticker"
    xmlns="http://www.w3.org/2000/svg"
    :width="size"
    :height="size"
    viewBox="-7 -7 62 62"
    fill="none"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <!-- The viewBox leaves room around the 48 grid for border and shadow. -->
    <g :transform="`rotate(${sticker.rotate} 24 24)`">
      <!-- Shadow and border: every shape again, fattened. currentColor is
           the theme's shadow color. -->
      <g class="sticker-shadow" :transform="`translate(0 ${SHADOW_OFFSET})`">
        <path
          v-for="(shape, i) in sticker.shapes"
          :key="i"
          :d="shape.d"
          :fill="shape.fill ? 'currentColor' : 'none'"
          stroke="currentColor"
          :stroke-width="shape.strokeWidth + CUT"
        />
      </g>
      <g class="sticker-border">
        <path
          v-for="(shape, i) in sticker.shapes"
          :key="i"
          :d="shape.d"
          :fill="shape.fill ? '#ffffff' : 'none'"
          stroke="#ffffff"
          :stroke-width="shape.strokeWidth + CUT"
        />
      </g>
      <g class="sticker-art">
        <path
          v-for="(shape, i) in sticker.shapes"
          :key="i"
          :d="shape.d"
          :fill="shape.fill ?? 'none'"
          :stroke="shape.stroke ?? 'none'"
          :stroke-width="shape.strokeWidth"
        />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.sticker {
  flex: none;
  overflow: visible;
  color: var(--color-shadow);
}
</style>
