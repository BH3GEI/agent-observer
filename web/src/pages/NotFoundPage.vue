<script setup lang="ts">
import { useI18n } from '../composables/useI18n'
const { t } = useI18n()
</script>

<template>
  <main class="poster-canvas min-h-[60vh]">
    <section class="section"><div class="wrap-narrow">
      <span class="poster-kicker">404</span>
      <h1 class="section-title mt-6">{{ t('common.not_found') }}</h1>
      <p class="mt-8"><router-link class="btn" to="/">{{ t('common.home') }} →</router-link></p>
    </div></section>
  </main>
</template>
