<script setup lang="ts">
import { provideI18n } from './composables/useI18n'
import { provideTheme } from './composables/useTheme'
import AppHeader from './components/layout/AppHeader.vue'
import AppFooter from './components/layout/AppFooter.vue'
import AnnouncementBanner from './components/layout/AnnouncementBanner.vue'
import FlashContainer from './components/layout/FlashContainer.vue'

provideI18n()
provideTheme()
</script>

<template>
  <AppHeader />
  <AnnouncementBanner />
  <router-view />
  <AppFooter />
  <FlashContainer />
</template>
