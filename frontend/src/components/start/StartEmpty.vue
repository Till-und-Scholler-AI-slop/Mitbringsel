<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import BaseIcon from '@/components/base/BaseIcon.vue'

// The start page without a household: found one or join one. The dialogs
// belong to the parent.
const emit = defineEmits<{ create: []; join: [] }>()

const { t } = useI18n()
</script>

<template>
  <div class="start-empty">
    <span class="badges" aria-hidden="true">
      <span class="badge badge--home"><BaseIcon name="home" :size="24" /></span>
      <span class="badge badge--cart"><BaseIcon name="cart" :size="24" /></span>
      <span class="badge badge--users"><BaseIcon name="users" :size="24" /></span>
    </span>

    <div class="intro">
      <h3 class="title">{{ t('start.empty.title') }}</h3>
      <p class="description">{{ t('start.empty.description') }}</p>
    </div>

    <div class="options">
      <button
        type="button"
        class="option option--create"
        aria-haspopup="dialog"
        @click="emit('create')"
      >
        <span class="option-icon" aria-hidden="true"
          ><BaseIcon name="plus" :size="24" :stroke-width="2.75"
        /></span>
        <span class="option-text">
          <span class="option-title">{{ t('start.create.open') }}</span>
          <span class="option-hint">{{ t('start.empty.createHint') }}</span>
        </span>
        <BaseIcon name="chevronRight" :size="22" :stroke-width="3" />
      </button>
      <button
        type="button"
        class="option option--join"
        aria-haspopup="dialog"
        @click="emit('join')"
      >
        <span class="option-icon" aria-hidden="true"><BaseIcon name="link" :size="24" /></span>
        <span class="option-text">
          <span class="option-title">{{ t('start.join.open') }}</span>
          <span class="option-hint">{{ t('start.empty.joinHint') }}</span>
        </span>
        <BaseIcon name="chevronRight" :size="22" :stroke-width="3" />
      </button>
    </div>

    <p class="no-link">{{ t('start.empty.noLink') }}</p>
  </div>
</template>

<style scoped>
.start-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.875rem;
  padding: 1.625rem 1.125rem var(--space-5);
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-2xl);
  background: var(--color-surface);
  box-shadow: var(--shadow-sticker);
  text-align: center;
}

.badges {
  display: flex;
  align-items: center;
}

/* Three stickers, slightly turned and overlapping. The accent colors and
   their ink stay the same in the dark theme. */
.badge {
  position: relative;
  display: grid;
  place-items: center;
  width: 3.25rem;
  height: 3.25rem;
  box-sizing: border-box;
  border: var(--border-width-md) solid var(--color-on-accent);
  border-radius: var(--radius-full);
  color: var(--color-on-accent);
}

.badge + .badge {
  margin-left: -10px;
}

.badge--home {
  z-index: 3;
  background: var(--color-accent-tomato);
  transform: rotate(-8deg);
}

.badge--cart {
  z-index: 2;
  background: var(--color-accent-lilac);
  transform: rotate(6deg);
}

.badge--users {
  z-index: 1;
  background: var(--color-accent-sky);
  transform: rotate(-4deg);
}

.intro {
  display: flex;
  flex-direction: column;
  gap: var(--space-1-5);
}

.title {
  margin: 0;
  font-size: 1.3125rem;
  font-weight: var(--font-weight-black);
  line-height: 1.625rem;
}

.description,
.no-link {
  margin: 0;
  color: var(--color-text-muted);
  font-weight: var(--font-weight-medium);
  overflow-wrap: break-word;
}

.description {
  font-size: var(--font-size-sm);
  line-height: 1.3125rem;
}

.no-link {
  font-size: var(--font-size-xs);
  line-height: 1.1875rem;
}

.options {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding-top: var(--space-1);
}

/* Sticker buttons that sink onto their shadow when pressed. */
.option {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 4.75rem;
  padding: var(--space-2) 0.875rem var(--space-2) 0.625rem;
  border: var(--border-width-md) solid var(--color-border);
  border-radius: var(--radius-xl);
  text-align: left;
  cursor: pointer;
  box-shadow: var(--shadow-sticker);
  transition:
    transform var(--duration-press) var(--easing-bounce),
    box-shadow var(--duration-press);
}

.option:active {
  transform: translateY(3px) scale(0.98);
  box-shadow: none;
  transition-duration: 60ms;
}

@media (prefers-reduced-motion: reduce) {
  .option {
    transition: none;
  }
}

.option :deep(svg) {
  flex: none;
}

.option--create {
  border-color: var(--color-on-accent);
  background: var(--color-primary);
  color: var(--color-primary-contrast);
}

.option--join {
  background: var(--color-surface);
  color: var(--color-text);
}

.option-icon {
  flex: none;
  display: grid;
  place-items: center;
  width: var(--size-touch);
  height: var(--size-touch);
  border-radius: var(--radius-full);
  color: var(--color-on-accent);
}

.option--create .option-icon {
  background: var(--color-accent-white);
}

.option--join .option-icon {
  background: var(--color-accent-lilac);
}

.option-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.option-title {
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-black);
  line-height: 1.4375rem;
}

.option-hint {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  line-height: 1.1875rem;
}

.option--join .option-hint {
  color: var(--color-text-muted);
}

/* Desktop: two columns, the text on the left, the options on the right. The
   grid areas move the hint about the link under the text. */
@media (min-width: 48rem) {
  .start-empty {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
    grid-template-areas:
      'badges options'
      'intro options'
      'note options';
    grid-template-rows: auto auto 1fr;
    align-items: start;
    justify-items: start;
    gap: var(--space-4) var(--space-8);
    padding: 2.25rem;
    text-align: left;
  }

  .badges {
    grid-area: badges;
  }

  .badge {
    width: 3.75rem;
    height: 3.75rem;
  }

  .badge + .badge {
    margin-left: -12px;
  }

  .intro {
    grid-area: intro;
    gap: var(--space-4);
  }

  .title {
    font-size: 1.875rem;
    line-height: 2.25rem;
    letter-spacing: -0.02em;
  }

  .description {
    font-size: 1.0625rem;
    line-height: 1.5rem;
  }

  .no-link {
    grid-area: note;
  }

  .options {
    grid-area: options;
    align-self: center;
    justify-self: stretch;
    gap: 0.875rem;
    padding-top: 0;
  }

  .option {
    gap: 0.875rem;
    min-height: 5.25rem;
    padding: 0.625rem 1.125rem 0.625rem var(--space-3);
    border-radius: var(--radius-2xl);
  }

  .option-icon {
    width: 3.5rem;
    height: 3.5rem;
  }

  .option-title {
    font-size: 1.25rem;
    line-height: 1.5625rem;
  }

  .option-hint {
    font-size: var(--font-size-sm);
    line-height: 1.25rem;
  }
}
</style>
