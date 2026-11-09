<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import AppSidebar from '@/components/layout/AppSidebar.vue'
import CreateGroupDialog from '@/components/start/CreateGroupDialog.vue'
import type { Group } from '@/types/api'

// The frame of the start page and the list view. From 48rem on the sidebar
// stands left of the page; below, the page brings its own green header and
// the sidebar is hidden (display: none, so screen readers skip it too).
defineProps<{ groupId?: string; listId?: string }>()

const router = useRouter()
const createOpen = ref(false)

function openCreated(group: Group) {
  return router.push({ name: 'group', params: { groupId: group.id } })
}
</script>

<template>
  <div class="frame">
    <div class="side">
      <AppSidebar
        class="sidebar"
        :group-id="groupId"
        :list-id="listId"
        @create="createOpen = true"
      />
    </div>
    <div class="page">
      <slot />
    </div>
    <CreateGroupDialog v-model:open="createOpen" @created="openCreated" />
  </div>
</template>

<style scoped>
.side {
  display: none;
}

@media (min-width: 48rem) {
  .frame {
    display: flex;
    align-items: flex-start;
  }

  /* Stays in view while the page scrolls; scrolls itself if it is taller
     than the window. */
  .side {
    position: sticky;
    top: 0;
    flex: none;
    display: flex;
    width: 18.875rem;
    height: 100vh;
    height: 100dvh;
    box-sizing: border-box;
    padding: var(--space-4);
  }

  .sidebar {
    flex: 1;
    min-width: 0;
    overflow-y: auto;
  }

  .page {
    flex: 1;
    min-width: 0;
  }
}
</style>
