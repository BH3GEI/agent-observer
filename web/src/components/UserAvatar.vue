<script setup lang="ts">
import { computed, ref } from 'vue'
import { teamAvatar } from '../lib/format'

// GitHub photo by default; a colored letter disc when there is no handle or the image 404s.
const props = defineProps<{ name: string; github?: string | null }>()
const failed = ref(false)
const handle = computed(() => (props.github || '')
  .trim()
  .replace(/^@/, '')
  .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
  .replace(/\/.*$/, ''))
</script>

<template>
  <img
    v-if="handle && !failed"
    class="user-avatar"
    :src="`https://github.com/${handle}.png?size=96`"
    :alt="name"
    loading="lazy"
    referrerpolicy="no-referrer"
    @error="failed = true"
  >
  <i v-else class="team-avatar user-avatar" :style="`--team-hue:${teamAvatar(name).hue}`" aria-hidden="true">{{ teamAvatar(name).initial }}</i>
</template>
