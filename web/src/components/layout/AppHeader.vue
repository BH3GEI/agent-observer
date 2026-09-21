<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '../../composables/useI18n'
import { useAuth } from '../../stores/auth'
import { useFlash } from '../../stores/flash'
import { useRegistrationOpen } from '../../composables/useRegistrationOpen'
import { usePhaseClock } from '../../composables/usePhaseClock'
import { isFullMoonToday } from '../../lib/eggs'
import { computed } from 'vue'

const { t, tf, pick, toggleLocale } = useI18n()
const route = useRoute()
const router = useRouter()
const { isLoggedIn, isAdmin, signOut } = useAuth()
const { registrationOpen } = useRegistrationOpen()
const flash = useFlash()
const mobileOpen = ref(false)
const fullMoon = isFullMoonToday()
const { current, next, usingFallback, countdown } = usePhaseClock()
const pad = (n: number) => String(n).padStart(2, '0')
const phasePill = computed(() => {
  if (current.value) return { text: `${pick(current.value.name_en, current.value.name_zh)} · ${t('leaderboard.status.open')}`, cls: 'open' }
  const name = next.value ? pick(next.value.name_en, next.value.name_zh) : usingFallback.value ? t('phase_clock.fallback_next') : null
  if (!name || (!next.value && !usingFallback.value)) return null
  return { text: `${name} · ${tf('phase_clock.in', { d: countdown.value.days, h: pad(countdown.value.hours) })}`, cls: 'upcoming' }
})

const items = [
  { key: 'nav.start', to: '/start' },
  { key: 'nav.leaderboard', to: '/leaderboard' },
  { key: 'nav.teammates', to: '/teammates' },
]
const handbook = [
  { key: 'nav.brief', to: '/brief' },
  { key: 'nav.rules', to: '/rules' },
  { key: 'nav.docs', to: '/docs' },
  { key: 'nav.resources', to: '/resources' },
  { key: 'nav.faq', to: '/faq' },
  { key: 'nav.announcements', to: '/announcements' },
]
const handbookOpen = ref(false)
const seriesOpen = ref(false)
type SeriesItem = { n: string; name: string; sub: string; href: string; current: boolean }
const seriesItems = computed(() => t('nav.series.items') as SeriesItem[])
const isActive = (to: string) => route.path === to || route.path.startsWith(`${to}/`)
const handbookActive = () => handbook.some(item => isActive(item.to))
const dashActive = () => ['/dashboard', '/team', '/submit', '/submissions', '/profile'].some(p => route.path.startsWith(p))
watch(() => route.fullPath, () => { mobileOpen.value = false; handbookOpen.value = false; seriesOpen.value = false })

async function logout() {
  mobileOpen.value = false
  await signOut()
  flash.success(t('auth.logout_done'))
  router.push('/')
}
</script>

<template>
  <header class="cosmos-header sticky top-0 z-50 border-b border-border backdrop-blur">
    <div class="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-6 px-5 md:px-10 xl:px-14">
      <div class="flex items-center gap-3">
        <router-link to="/" aria-label="Agentic Observer home" class="flex items-center gap-3">
          <span class="cosmos-wordmark shrink-0 whitespace-nowrap text-lg text-[#f5f5f5]">GOSIM <span class="text-[#315efb]">Create</span></span>
        </router-link>
        <span class="hidden h-4 w-px bg-white/25 sm:block"></span>
        <div class="series-drop relative hidden sm:block" @mouseenter="seriesOpen = true" @mouseleave="seriesOpen = false">
          <button type="button" class="inline-flex h-10 items-center gap-1.5 whitespace-nowrap font-mono text-xs uppercase tracking-[.1em] text-white/70 transition-colors hover:text-white" :aria-expanded="seriesOpen" @click="seriesOpen = !seriesOpen">
            {{ t('meta.wordmark_note') }} <span aria-hidden="true" class="text-[.6rem] transition-transform" :class="{ 'rotate-180': seriesOpen }">▾</span>
          </button>
          <div v-show="seriesOpen" class="series-panel">
            <div class="series-head"><span>{{ t('nav.series.label') }}</span><span>{{ t('nav.series.pick') }} ↓</span></div>
            <component :is="item.href ? 'a' : 'router-link'" v-for="item in seriesItems" :key="item.n"
              :href="item.href || undefined" :to="item.href ? undefined : '/'"
              class="series-item" :class="{ current: item.current }">
              <span class="series-n">{{ item.n }}</span>
              <span class="min-w-0">
                <b>{{ item.name }}</b>
                <small>{{ item.sub }}</small>
              </span>
              <span v-if="item.current" class="series-current">{{ t('nav.series.current') }}</span>
            </component>
          </div>
        </div>
      </div>

      <nav class="hidden items-center gap-5 lg:flex">
        <router-link
          v-for="item in items"
          :key="item.to"
          :to="item.to"
          class="inline-flex h-10 items-center font-mono text-xs uppercase tracking-[.06em] transition-colors hover:text-[#78a6ff]"
          :class="isActive(item.to) ? 'text-[#78a6ff]' : 'text-white/50'"
        >{{ t(item.key) }}</router-link>
        <div class="nav-drop relative" @mouseenter="handbookOpen = true" @mouseleave="handbookOpen = false">
          <button type="button" class="inline-flex h-10 items-center gap-1 font-mono text-xs uppercase tracking-[.06em] transition-colors hover:text-[#78a6ff]" :class="handbookActive() ? 'text-[#78a6ff]' : 'text-white/50'" :aria-expanded="handbookOpen" @click="handbookOpen = !handbookOpen">
            {{ t('nav.handbook') }} <span aria-hidden="true" class="text-[.6rem]">▾</span>
          </button>
          <div v-show="handbookOpen" class="nav-drop-panel">
            <router-link v-for="item in handbook" :key="item.to" :to="item.to" class="nav-drop-item" :class="{ active: isActive(item.to) }">{{ t(item.key) }}</router-link>
          </div>
        </div>
        <router-link v-if="isLoggedIn" to="/dashboard" class="inline-flex h-10 items-center font-mono text-xs uppercase tracking-[.06em] transition-colors hover:text-[#78a6ff]" :class="dashActive() ? 'text-[#78a6ff]' : 'text-white/50'">{{ t('nav.dashboard') }}</router-link>
        <router-link v-if="isAdmin" to="/admin" class="inline-flex h-10 items-center font-mono text-xs uppercase tracking-[.06em] transition-colors hover:text-[#78a6ff]" :class="route.path.startsWith('/admin') ? 'text-[#78a6ff]' : 'text-white/50'">{{ t('nav.admin') }}</router-link>
      </nav>

      <div class="flex items-center gap-2">
        <router-link v-if="phasePill" to="/leaderboard" class="pill header-phase-pill" :class="phasePill.cls" data-testid="phase-pill">{{ phasePill.text }}</router-link>
        <span v-if="fullMoon" class="moon-chip" :title="pick('Full moon tonight. Moonlight washes out the faint stars, so real telescopes spend nights like this on bright targets.', '今晚满月。月光会盖过暗弱的星星，真实的望远镜这种晚上就去拍亮目标。')">🌕</span>
        <button data-testid="lang-toggle" type="button" @click="toggleLocale" class="inline-flex h-10 min-w-12 items-center justify-center border border-white/25 px-2 font-mono text-xs uppercase text-white/55 transition-colors hover:border-white/60 hover:text-white">
          {{ pick('中文', 'EN') }}
        </button>
        <button v-if="isLoggedIn" data-testid="nav-logout" type="button" @click="logout" class="ml-1 hidden h-10 items-center border border-white/35 px-4 font-mono text-xs font-semibold uppercase tracking-widest text-[#f5f5f5] transition-colors hover:border-[#315efb] hover:text-[#78a6ff] md:inline-flex">{{ t('nav.logout') }}</button>
        <router-link v-else-if="registrationOpen" data-testid="nav-register" to="/register" class="cosmos-register-link ml-1 hidden h-10 items-center border px-4 font-mono text-xs font-semibold uppercase tracking-widest md:inline-flex">{{ t('nav.register') }}</router-link>
        <router-link v-else data-testid="nav-register" to="/register?mode=login" class="cosmos-register-link ml-1 hidden h-10 items-center border px-4 font-mono text-xs font-semibold uppercase tracking-widest md:inline-flex">{{ t('nav.login') }}</router-link>
        <button class="ml-1 lg:hidden" type="button" @click="mobileOpen = !mobileOpen" :aria-label="t('nav.menu')" :aria-expanded="mobileOpen">
          <svg class="h-6 w-6 text-text-primary" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </div>
    </div>

    <div v-if="mobileOpen" class="border-t border-white/20 bg-[#070708] px-5 py-4 lg:hidden">
      <router-link v-for="item in items" :key="item.to" :to="item.to" class="block border-b border-white/10 py-3 text-base text-white/60 transition-colors hover:text-white">{{ t(item.key) }}</router-link>
      <router-link v-if="isLoggedIn" to="/dashboard" class="block border-b border-white/10 py-3 text-base text-white/60 transition-colors hover:text-white">{{ t('nav.dashboard') }}</router-link>
      <router-link v-if="isAdmin" to="/admin" class="block border-b border-white/10 py-3 text-base text-white/60 transition-colors hover:text-white">{{ t('nav.admin') }}</router-link>
      <p class="mt-4 mb-1 font-mono text-[.62rem] uppercase tracking-[.14em] text-white/35">{{ t('nav.series.label') }}</p>
      <template v-for="item in seriesItems" :key="item.n">
        <a v-if="item.href" :href="item.href" class="block border-b border-white/10 py-3 text-base text-white/60 transition-colors hover:text-white">{{ item.name }} <small class="text-white/35">{{ item.sub }}</small></a>
      </template>
      <p class="mt-4 mb-1 font-mono text-[.62rem] uppercase tracking-[.14em] text-white/35">{{ t('nav.handbook') }}</p>
      <router-link v-for="item in handbook" :key="item.to" :to="item.to" class="block border-b border-white/10 py-3 text-base text-white/60 transition-colors hover:text-white">{{ t(item.key) }}</router-link>
      <button v-if="isLoggedIn" type="button" @click="logout" class="mt-3 block w-full border border-white/35 px-4 py-3 text-center font-mono text-xs font-semibold uppercase tracking-widest text-[#f5f5f5]">{{ t('nav.logout') }}</button>
      <template v-else>
        <router-link v-if="registrationOpen" to="/register" class="cosmos-register-link mt-3 block border px-4 py-3 text-center font-mono text-xs font-semibold uppercase tracking-widest">{{ t('nav.register') }}</router-link>
        <router-link to="/register?mode=login" class="mt-3 block border border-white/35 px-4 py-3 text-center font-mono text-xs font-semibold uppercase tracking-widest text-[#f5f5f5]">{{ t('nav.login') }}</router-link>
      </template>
    </div>
  </header>
</template>
