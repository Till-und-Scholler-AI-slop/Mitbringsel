<script setup lang="ts">
// The context column next to the list from CONTEXT_COLUMN_QUERY on (design
// "markt2-kontext-*"): a stack of cards that stays in view while the list
// scrolls. The open card takes the height that is left and scrolls inside.
// It is the second column of ListView's grid, below the header.
</script>

<template>
  <div class="context-column">
    <slot />
  </div>
</template>

<style scoped>
.context-column {
  grid-column: 2;
  grid-row: 2;
  position: sticky;
  top: var(--space-6);
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  /* As in the design: 812px at most, the window minus the header, at least
     560px. rem, so the root font size of large screens scales it. */
  height: min(50.75rem, 100dvh - 11.875rem);
  min-height: 35rem;
}
</style>
