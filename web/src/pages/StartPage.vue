<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../composables/useI18n'
import { usePublicSettings } from '../composables/usePublicSettings'
import { useAuth } from '../stores/auth'
import PageHead from '../components/layout/PageHead.vue'
import MarkdownArticle from '../components/content/MarkdownArticle.vue'
import startEn from '../content/start.en.md?raw'
import startZh from '../content/start.zh.md?raw'

/** The participant walkthrough: register -> team -> run the kit -> edit one function -> upload -> read the score.
 *  Deliberately lighter than the Docs page, which is the engineer's reference. */
const { t, pick } = useI18n()
const { isLoggedIn } = useAuth()
const { mechanicsPublic } = usePublicSettings()
const source = computed(() => {
  const text = pick(startEn, startZh)
  return mechanicsPublic.value ? text : text.replace(/<!-- mechanics:start -->[\s\S]*?<!-- mechanics:end -->/g, '')
})
</script>

<template>
  <main class="poster-canvas page-read">
    <PageHead :kicker="t('start_page.kicker')" :title="t('start_page.title')" :lede="t('start_page.lede')">
      <p class="actions-inline mt-8">
        <router-link v-if="!isLoggedIn" class="btn primary" to="/register">{{ t('start_page.cta_register') }} →</router-link>
        <router-link v-else class="btn primary" to="/dashboard">{{ t('start_page.cta_dashboard') }} →</router-link>
        <router-link class="btn" to="/resources">{{ t('start_page.cta_kit') }} ↓</router-link>
        <router-link class="btn" to="/docs">{{ t('start_page.cta_docs') }} →</router-link>
      </p>
    </PageHead>
    <section class="section"><div class="wrap">
      <MarkdownArticle :source="source" />
    </div></section>
  </main>
</template>
