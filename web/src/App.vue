<script setup lang="ts">
import { provideI18n } from './composables/useI18n'
import { provideTheme } from './composables/useTheme'
import AppHeader from './components/layout/AppHeader.vue'
import AppFooter from './components/layout/AppFooter.vue'
import AnnouncementBanner from './components/layout/AnnouncementBanner.vue'
import FlashContainer from './components/layout/FlashContainer.vue'
import RegisterFloat from './components/layout/RegisterFloat.vue'
import ScrollProgress from './components/layout/ScrollProgress.vue'
import BrowserNotice from './components/layout/BrowserNotice.vue'

const { t } = provideI18n()
provideTheme()
</script>

<template>
  <a href="#main-content" class="skip-link">{{ t('a11y.skip') }}</a>
  <ScrollProgress />
  <BrowserNotice />
  <RegisterFloat />
  <AppHeader />
  <AnnouncementBanner />
  <div id="main-content" tabindex="-1">
    <!-- a short cross-fade between routes, so a navigation reads as a change of place rather than a flash -->
    <router-view v-slot="{ Component, route }">
      <transition name="page" mode="out-in">
        <component :is="Component" :key="route.path" />
      </transition>
    </router-view>
  </div>
  <AppFooter />
  <FlashContainer />
</template>
