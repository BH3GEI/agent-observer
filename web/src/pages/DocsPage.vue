<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from '../composables/useI18n'
import PageHead from '../components/layout/PageHead.vue'
import MarkdownArticle, { type TocItem } from '../components/content/MarkdownArticle.vue'
import docsEn from '../content/docs.en.md?raw'
import docsZh from '../content/docs.zh.md?raw'

const { t, pick } = useI18n()
const source = computed(() => pick(docsEn, docsZh))
const toc = ref<TocItem[]>([])
</script>

<template>
  <main class="poster-canvas">
    <PageHead :kicker="t('docs_page.kicker')" :title="t('docs_page.title')" />
    <section class="section"><div class="wrap">
      <div class="grid gap-12 lg:grid-cols-[15rem_1fr] lg:gap-16">
        <aside class="hidden lg:block">
          <nav class="toc">
            <span class="label mb-2 block">{{ t('docs_page.toc') }}</span>
            <a v-for="item in toc" :key="item.id" :href="`#${item.id}`" :class="{ lvl3: item.level === 3 }">{{ item.text }}</a>
          </nav>
        </aside>
        <MarkdownArticle :source="source" @toc="toc = $event" />
      </div>
    </div></section>
  </main>
</template>
