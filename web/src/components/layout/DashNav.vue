<script setup lang="ts">
import { useRoute } from 'vue-router'
import { useI18n } from '../../composables/useI18n'
const { t } = useI18n()
const route = useRoute()
const items = [
  { to: '/dashboard', key: 'dash.title', exact: true },
  { to: '/team', key: 'nav.team' },
  { to: '/submit', key: 'nav.submit', exact: true },
  { to: '/submissions', key: 'nav.submissions' },
  { to: '/profile', key: 'nav.profile', exact: true },
]
const isActive = (item: { to: string; exact?: boolean }) => item.exact ? route.path === item.to : route.path.startsWith(item.to)
</script>

<template>
  <nav class="admin-nav">
    <router-link v-for="item in items" :key="item.to" :to="item.to" :class="{ active: isActive(item) }">{{ t(item.key) }}</router-link>
  </nav>
</template>
