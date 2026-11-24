<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'
import type { IconName } from '@/components/base/icons'
import BrandLogo from '@/components/BrandLogo.vue'

const { t } = useI18n()

// The three kinds of shops the app is made for, shown as stickers. On the
// phone only their icons, on the desktop with labels.
const SHOPS: { key: string; icon: IconName }[] = [
  { key: 'supermarket', icon: 'cart' },
  { key: 'drugstore', icon: 'sprayCan' },
  { key: 'hardware', icon: 'hammer' },
]
</script>

<template>
  <!-- Phone: a slim bar with logo and icon stack (design iteration 2).
       Desktop: the left half of the card with slogan and labelled chips. -->
  <div class="brand">
    <BrandLogo class="logo" />

    <span class="stack" aria-hidden="true">
      <span v-for="shop in SHOPS" :key="shop.key" :class="['stack-item', `shop--${shop.key}`]">
        <BaseIcon :name="shop.icon" />
      </span>
    </span>

    <p class="tagline">{{ t('login.tagline') }}</p>

    <div class="chips" aria-hidden="true">
      <span v-for="shop in SHOPS" :key="shop.key" :class="['chip', `shop--${shop.key}`]">
        <span class="chip-dot"><BaseIcon :name="shop.icon" :size="16" /></span>
        {{ t(`login.shops.${shop.key}`) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5) var(--space-4);
  border-radius: 0 0 var(--radius-xl) var(--radius-xl);
  background: var(--color-brand);
  color: var(--color-on-brand);
}

/* Overlapping round stickers, each slightly turned. */
.stack {
  flex: none;
  display: flex;
  align-items: center;
  padding-right: 2px;
}

.stack-item {
  position: relative;
  display: grid;
  place-items: center;
  width: 2.375rem;
  height: 2.375rem;
  border: var(--border-width-sm) solid var(--color-on-accent);
  border-radius: var(--radius-full);
  color: var(--color-on-accent);
  box-shadow: var(--shadow-sticker-sm);
}

.stack-item + .stack-item {
  margin-left: calc(-1 * var(--space-2));
}

.stack-item.shop--supermarket {
  z-index: 3;
  background: var(--color-accent-tomato);
  transform: rotate(-8deg);
}

.stack-item.shop--drugstore {
  z-index: 2;
  background: var(--color-accent-lilac);
  transform: rotate(6deg);
}

.stack-item.shop--hardware {
  z-index: 1;
  background: var(--color-accent-sky);
  transform: rotate(-4deg);
}

/* Desktop-only parts. */
.tagline,
.chips {
  display: none;
}

@media (min-width: 48rem) {
  .brand {
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: var(--space-7);
    padding: var(--space-14) var(--space-12);
    border-radius: 0;
  }

  /* With .brand in front, this wins over BrandLogo's own root class. */
  .brand .logo {
    font-size: 2.5rem;
  }

  .stack {
    display: none;
  }

  .tagline {
    display: block;
    max-width: 32.5rem;
    margin: 0;
    font-size: var(--font-size-3xl);
    font-weight: var(--font-weight-display);
    line-height: var(--line-height-heading);
    letter-spacing: -0.02em;
    overflow-wrap: break-word;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    row-gap: var(--space-3);
    padding: var(--space-1) 0 var(--space-1) var(--space-1);
  }
}

.chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--size-touch);
  padding: 0 var(--space-3) 0 var(--space-1);
  border: var(--border-width-sm) solid var(--color-border);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-heavy);
  white-space: nowrap;
  box-shadow: var(--shadow-sticker);
}

.chip + .chip {
  margin-left: calc(-1 * var(--space-2));
}

.chip-dot {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-full);
  color: var(--color-on-accent);
}

/* The first chip is the highlighted one, in tomato with a white dot. */
.chip.shop--supermarket {
  z-index: 3;
  border-color: var(--color-on-accent);
  background: var(--color-accent-tomato);
  color: var(--color-on-accent);
  transform: rotate(-4deg);
}

.chip.shop--supermarket .chip-dot {
  background: var(--color-on-brand);
}

.chip.shop--drugstore {
  z-index: 2;
  transform: rotate(3deg);
}

.chip.shop--drugstore .chip-dot {
  background: var(--color-accent-lilac);
}

.chip.shop--hardware {
  z-index: 1;
  transform: rotate(-2deg);
}

.chip.shop--hardware .chip-dot {
  background: var(--color-accent-sky);
}
</style>
