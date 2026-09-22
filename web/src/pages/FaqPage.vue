<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'
import { usePublicSettings } from '../composables/usePublicSettings'
import PageHead from '../components/layout/PageHead.vue'
const { t, pick } = useI18n()
type Item = { q: string; a: string }
const { mechanicsPublic } = usePublicSettings()
const items = computed(() => (t('faq.items') as (Item & { gated?: boolean })[])
  .filter(item => mechanicsPublic.value || !item.gated))
</script>

<template>
  <main class="poster-canvas page-read">
    <PageHead :kicker="t('faq.kicker')" :title="t('faq.title')" />
    <section class="section"><div class="wrap-narrow">
      <details v-for="(item, index) in items" :key="index" class="faq" :id="`q${index + 1}`" :open="index < 3">
        <summary>{{ item.q }}</summary>
        <p>{{ item.a }}</p>
      </details>
      <p class="text3 mt-12 text-sm">{{ pick('Other questions:', '其他问题：') }} <a class="accent-l" :href="`mailto:${t('footer.contact_email')}`">{{ t('footer.contact_email') }}</a></p>
    </div></section>
  </main>
</template>
