<script setup lang="ts">
import LoginBrandHeader from './LoginBrandHeader.vue'
</script>

<template>
  <!-- Phone first: brand bar on top, the slot below as a column whose last
       child can sit at the bottom with margin-top: auto. -->
  <div class="login-page">
    <div class="frame">
      <LoginBrandHeader class="brand" />
      <main class="content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--color-bg);
}

.frame {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
  padding: var(--space-8) var(--space-5) var(--space-3);
}

/* Desktop: one card, brand on the left, content on the right. Narrow
   windows wrap the two halves on top of each other. */
@media (min-width: 48rem) {
  .login-page {
    align-items: center;
    justify-content: center;
    padding: var(--space-10) var(--space-6);
  }

  .frame {
    flex: none;
    flex-direction: row;
    flex-wrap: wrap;
    width: 100%;
    max-width: 65rem;
    overflow: hidden;
    border: var(--border-width-lg) solid var(--color-border);
    border-radius: var(--radius-2xl);
    background: var(--color-surface);
    box-shadow: var(--shadow-sticker-lg);
  }

  .brand,
  .content {
    flex: 1 1 26.25rem;
    min-width: 0;
  }

  .content {
    padding: var(--space-14) var(--space-12) var(--space-7);
  }
}
</style>
