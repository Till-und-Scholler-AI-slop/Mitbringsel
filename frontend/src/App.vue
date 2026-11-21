<script setup lang="ts">
import { watchEffect } from 'vue'
import { RouterView } from 'vue-router'

import { useItemRejections } from '@/composables/useItemRejections'
import { useLocale } from '@/composables/useLocale'

const { locale } = useLocale()
useItemRejections()

// Screen readers and hyphenation follow <html lang>, so it tracks the app language.
watchEffect(() => {
  document.documentElement.lang = locale.value
})
</script>

<template>
  <RouterView />
</template>
