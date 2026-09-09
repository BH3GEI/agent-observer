<script setup lang="ts">
import { provideI18n } from './composables/useI18n'
import { provideTheme } from './composables/useTheme'
import AppHeader from './components/layout/AppHeader.vue'
import AppFooter from './components/layout/AppFooter.vue'
import AnnouncementBanner from './components/layout/AnnouncementBanner.vue'
import FlashContainer from './components/layout/FlashContainer.vue'

const { t } = provideI18n()
provideTheme()
</script>

<template>
  <a href="#main-content" class="skip-link">{{ t('a11y.skip') }}</a>
  <AppHeader />
  <AnnouncementBanner />
  <div id="main-content" tabindex="-1">
    <router-view />
  </div>
  <AppFooter />
  <FlashContainer />
</template>
