<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { appUrl } from '../../composables/api'
import { isSupabaseConfigured } from '../../lib/supabase'
import { loadAnnouncements, type Announcement } from '../../lib/data'
import { fmtUtc } from '../../lib/format'

const { t, pick } = useI18n()

const orgLogos: Record<string, string> = {
  'GOSIM Foundation': appUrl('media/gosim-logo.svg'),
  KIMI: appUrl('media/kimi-logo.png'),
}
type Item = { role: string; name: string; desc: string }
type Member = { photo: string; name: string; title: string; org: string }
const items = computed(() => t('home.credibility.items') as Item[])
const committee = computed(() => t('home.credibility.committee.members') as Member[])
const announcements = ref<Announcement[]>([])

onMounted(async () => {
  if (!isSupabaseConfigured) return
  try { announcements.value = await loadAnnouncements(5) } catch { announcements.value = [] }
})
</script>

<template>
  <section id="organizers" class="poster-section poster-canvas py-20 md:py-28">
    <div class="mx-auto max-w-[1600px] px-5 md:px-10 xl:px-14">
      <div class="reveal">
        <span class="poster-kicker">{{ t('home.credibility.kicker') }}</span>
        <h2 class="section-title distressed-type mt-8">{{ t('home.credibility.title') }}</h2>
      </div>
      <div class="cards cards-3 cards-fit reveal-stagger mt-14">
        <article v-for="item in items" :key="item.name" v-tilt class="card card-lift org-card">
          <span class="label accent">{{ item.role }}</span>
          <img v-if="orgLogos[item.name]" :src="orgLogos[item.name]" :alt="`${item.name} logo`" class="org-logo" loading="lazy">
          <h3 class="mt-3">{{ item.name }}</h3>
          <p>{{ item.desc }}</p>
        </article>
      </div>
      <div class="reveal mt-16">
        <div class="rule-b pb-3">
          <span class="label accent">{{ t('home.credibility.committee.kicker') }}</span>
        </div>
        <p class="mt-7 max-w-5xl text-[clamp(1.4rem,3vw,2.6rem)] font-medium leading-[1.3] tracking-[-.025em] text-[#e8edf8]">{{ t('home.credibility.committee.intro') }}</p>
        <div class="reveal-stagger mt-10 grid grid-cols-3 gap-3 sm:grid-cols-4 md:gap-4 lg:grid-cols-7">
          <figure v-for="m in committee" :key="m.photo" v-tilt class="card card-lift committee-card">
            <img :src="appUrl(`media/committee/${m.photo}.webp`)" :alt="m.name" class="aspect-[3/4] w-full object-cover" loading="lazy" />
            <figcaption class="mt-4">
              <h3>{{ m.name }}</h3>
              <p>{{ m.title }} · {{ m.org }}</p>
            </figcaption>
          </figure>
        </div>
        <a class="octos-card card card-lift mt-6 flex flex-wrap items-center gap-6" href="https://github.com/octos-org/" target="_blank" rel="noopener" :aria-label="t('home.credibility.octos.cta')">
          <img :src="appUrl('media/octos-logo.webp')" :alt="t('home.credibility.octos.logoAlt')" class="h-14 w-auto object-contain md:h-16" loading="lazy" />
          <span class="min-w-0 flex-1">
            <span class="label accent-amber block">{{ t('home.credibility.octos.kicker') }}</span>
            <h3 class="mt-2">{{ t('home.credibility.octos.title') }}</h3>
            <p>{{ t('home.credibility.octos.desc') }}</p>
          </span>
          <span class="label accent whitespace-nowrap">{{ t('home.credibility.octos.cta') }} ↗</span>
        </a>
      </div>
      <div v-if="announcements.length" class="reveal mt-14">
        <div class="flex items-center justify-between gap-4 rule-b pb-3">
          <span class="label">{{ t('home.announcements.kicker') }}</span>
          <router-link to="/announcements" class="label accent">{{ t('home.announcements.all') }} →</router-link>
        </div>
        <div v-for="a in announcements" :key="a.id" class="row-sweep flex flex-wrap items-center justify-between gap-3 border-b border-white/10 py-4 pl-3">
          <span class="text-text-primary">{{ pick(a.title_en, a.title_zh) || a.title_en }}</span>
          <span class="label">{{ fmtUtc(a.created_at).slice(0, 10) }}</span>
        </div>
      </div>
    </div>
  </section>
</template>
