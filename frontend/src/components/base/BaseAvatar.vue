<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const DEFAULT_SIZE = 40
// Share of the avatar size taken by the initial.
const INITIAL_FONT_RATIO = 0.42
const FALLBACK_INITIAL = '?'

// Background colors for the initials, taken from the fixed accent tokens.
const FALLBACK_COLORS = [
  'var(--color-accent-tomato)',
  'var(--color-accent-lilac)',
  'var(--color-accent-sky)',
  'var(--color-accent-sun)',
] as const

// The avatar is decoration: the name always stands next to it, so screen
// readers skip it. referrerpolicy keeps the page address away from the
// server that hosts the picture (Google).
const props = withDefaults(defineProps<{ name: string; src?: string | null; size?: number }>(), {
  src: null,
  size: DEFAULT_SIZE,
})

// A picture that cannot be loaded (deleted, blocked) falls back to the
// initial instead of showing a broken image. A new src gets a new try.
const failed = ref(false)
watch(
  () => props.src,
  () => {
    failed.value = false
  },
)

const showImage = computed(() => Boolean(props.src) && !failed.value)

// Array.from keeps a character outside the basic plane (e.g. an emoji) whole.
const initial = computed(() => Array.from(props.name.trim())[0]?.toUpperCase() ?? FALLBACK_INITIAL)

// The same name always gets the same color.
const color = computed(() => {
  const sum = Array.from(props.name).reduce((acc, char) => acc + (char.codePointAt(0) ?? 0), 0)
  return FALLBACK_COLORS[sum % FALLBACK_COLORS.length]
})

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.round(props.size * INITIAL_FONT_RATIO)}px`,
}))
</script>

<template>
  <img
    v-if="showImage"
    class="avatar"
    :src="src ?? undefined"
    alt=""
    referrerpolicy="no-referrer"
    :style="style"
    @error="failed = true"
  />
  <span
    v-else
    class="avatar avatar--initial"
    aria-hidden="true"
    :style="[style, { background: color }]"
  >
    {{ initial }}
  </span>
</template>

<style scoped>
.avatar {
  flex: none;
  display: block;
  border-radius: var(--radius-full);
  object-fit: cover;
}

.avatar--initial {
  display: grid;
  place-items: center;
  color: var(--color-on-accent);
  font-weight: var(--font-weight-black);
  line-height: 1;
  user-select: none;
}
</style>
