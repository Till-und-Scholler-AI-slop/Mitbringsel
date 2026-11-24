<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

// The app name as two price tags: a lemon tag with berry letters in front,
// a berry tag tilted behind it. small: the compact head of the list view.
// large: the big logo of a desktop brand panel (invite page).
withDefaults(defineProps<{ small?: boolean; large?: boolean }>(), {
  small: false,
  large: false,
})

const { t } = useI18n()

const name = computed(() => t('app.name'))

// The dot of the first "i" is drawn as a small lilac circle.
const wordmark = computed(() => {
  const at = name.value.indexOf('i')
  if (at < 0) return null
  return { before: name.value.slice(0, at), after: name.value.slice(at + 1) }
})
</script>

<template>
  <span
    :class="['logo', { 'logo--small': small, 'logo--large': large }]"
    role="img"
    :aria-label="name"
  >
    <!-- The back tag holds the name invisibly, so both tags get the same size. -->
    <span class="tag tag--back" aria-hidden="true"
      ><span class="hole"></span><span class="ghost">{{ name }}</span></span
    >
    <span class="tag tag--front" aria-hidden="true"
      ><span class="hole"></span
      ><span v-if="wordmark"
        >{{ wordmark.before }}<span class="i">ı<span class="dot"></span></span
        >{{ wordmark.after }}</span
      ><span v-else>{{ name }}</span></span
    >
  </span>
</template>

<style scoped>
/* All sizes in em, so the tags scale with the font size of the variant. */
.logo {
  position: relative;
  display: inline-block;
  font-size: 1.75rem;
  font-weight: var(--font-weight-black);
  line-height: 1.05;
  letter-spacing: -0.02em;
  white-space: nowrap;
}

.logo--small {
  font-size: var(--font-size-lg);
}
.logo--large {
  font-size: 2.5rem;
}

/* A price tag: square-ish corners at the hole, round at the far end. The
   shadow is a drop-shadow, not a box-shadow: box-shadow is cut off under the
   border box, so on a tilted tag a thin seam of the background would show
   between border and shadow. */
.tag {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  padding: 0.16em 0.55em 0.18em 0.32em;
  border: 0.06em solid var(--color-on-accent);
  border-radius: 0.22em 0.5em 0.5em 0.22em;
  filter: drop-shadow(0 0.08em 0 var(--color-on-accent));
}

.tag--back {
  position: absolute;
  top: 0;
  left: 0;
  background: var(--color-logo-berry);
  transform: rotate(7deg) translate(0.18em, 0.08em);
}

.ghost {
  visibility: hidden;
}

.tag--front {
  position: relative;
  background: var(--color-logo-lemon);
  color: var(--color-logo-berry);
  transform: rotate(-4deg);
}

.hole {
  flex: none;
  width: 0.26em;
  height: 0.26em;
  box-sizing: border-box;
  border: 0.05em solid var(--color-on-accent);
  border-radius: var(--radius-full);
  background: var(--color-logo-berry);
}

/* Dotless i with a lilac circle as its dot. */
.i {
  position: relative;
  display: inline-block;
}

.dot {
  position: absolute;
  left: 50%;
  top: 0.06em;
  width: 0.24em;
  height: 0.24em;
  margin-left: -0.12em;
  box-sizing: border-box;
  border: 0.045em solid var(--color-on-accent);
  border-radius: var(--radius-full);
  background: var(--color-logo-dot);
}
</style>
