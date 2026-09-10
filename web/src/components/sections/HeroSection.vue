<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { assetUrl } from '../../composables/api'
import { useAuth } from '../../stores/auth'
import { useRegistrationOpen } from '../../composables/useRegistrationOpen'
import { usePhaseClock } from '../../composables/usePhaseClock'
import { fmtUtc } from '../../lib/format'
import SkyConsole from './SkyConsole.vue'

const { t, tf, pick, locale } = useI18n()
const { isLoggedIn } = useAuth()
const { registrationOpen } = useRegistrationOpen()
const { current, next, nextStartsAt, usingFallback, countdown, loaded } = usePhaseClock()
type Metric = { value: string; label: string }
const metrics = computed(() => t('hero.metrics') as Metric[])
const heroTitleLines = computed(() => locale.value === 'zh' ? ['巡天智能体'] : ['Agent Observer'])
const pad = (n: number) => String(n).padStart(2, '0')
const nextName = computed(() => next.value ? pick(next.value.name_en, next.value.name_zh) : usingFallback.value ? t('phase_clock.fallback_next') : current.value?.ends_at ? tf('phase_clock.ends', { name: pick(current.value.name_en, current.value.name_zh) }) : t('phase_clock.none_scheduled'))
const parts = computed(() => [
  { v: String(countdown.value.days), l: t('phase_clock.days') },
  { v: pad(countdown.value.hours), l: t('phase_clock.hours') },
  { v: pad(countdown.value.minutes), l: t('phase_clock.minutes') },
  { v: pad(countdown.value.seconds), l: t('phase_clock.seconds') },
])
</script>

<template>
  <section id="top" class="hero-section cosmos-hero poster-canvas">
    <div class="hero-wash" aria-hidden="true" :style="{ backgroundImage: `url(${assetUrl('/media/survey-milky-way.jpg')})` }"></div>

    <div class="relative z-10 mx-auto max-w-[1600px] px-5 md:px-10 xl:px-14">
      <div class="hero-grid">
        <div class="hero-copy">
          <div class="hero-kicker mb-6 flex items-center gap-4 font-mono text-xs uppercase leading-relaxed tracking-[.12em] text-[#78a6ff] md:text-sm">
            <span class="live-dot h-2 w-2 bg-[#78a6ff]"></span>
            {{ t('hero.eyebrow') }}
          </div>

          <h1 class="hero-title" :class="{ 'hero-title-zh': locale === 'zh' }" :aria-label="t('hero.system')">
            <span v-for="line in heroTitleLines" :key="line" class="hero-title-line">{{ line }}</span>
          </h1>
          <p class="hero-subtitle mt-3 font-mono text-sm uppercase tracking-[.22em] text-[#78a6ff]">{{ t('hero.subtitle') }}</p>

          <p class="mt-7 max-w-xl text-base leading-[1.75] text-white/82 md:text-lg">{{ t('hero.lede') }}</p>
          <div class="mt-7 flex flex-wrap gap-3">
            <router-link v-if="isLoggedIn" to="/dashboard" class="hero-action hero-action-primary">
              {{ t('hero.cta_dashboard') }} <span>→</span>
            </router-link>
            <router-link v-else-if="registrationOpen" to="/register" class="hero-action hero-action-primary">
              {{ t('hero.cta_register') }} <span>→</span>
            </router-link>
            <span v-else aria-disabled="true" class="hero-action hero-action-primary pointer-events-none opacity-60">
              {{ t('nav.registration_closed') }}
            </span>
            <router-link to="/brief" class="hero-action">
              {{ t('hero.cta_brief') }} <span>→</span>
            </router-link>
          </div>

          <div class="phase-strip mt-9" data-testid="phase-strip">
            <div class="phase-strip-now">
              <span class="phase-strip-label">{{ t('phase_clock.now') }}</span>
              <span v-if="current" class="pill open">{{ pick(current.name_en, current.name_zh) }} · {{ t('leaderboard.status.open') }}</span>
              <span v-else-if="loaded" class="pill">{{ t('phase_clock.no_open') }}</span>
              <span v-else class="pill" aria-busy="true">…</span>
            </div>
            <div class="phase-strip-next">
              <span class="phase-strip-label">{{ t('phase_clock.next') }} · {{ loaded ? nextName : '…' }}<template v-if="nextStartsAt"> · {{ fmtUtc(nextStartsAt) }} UTC</template></span>
              <div v-if="nextStartsAt" class="phase-countdown" role="timer" :aria-label="t('phase_clock.countdown_aria')">
                <span v-for="p in parts" :key="p.l"><b>{{ p.v }}</b><small>{{ p.l }}</small></span>
              </div>
            </div>
          </div>
        </div>

        <div class="hero-console">
          <SkyConsole />
        </div>
      </div>

      <div class="hero-metrics grid grid-cols-2 border-t border-white/22 md:grid-cols-4">
        <div v-for="(metric, index) in metrics" :key="metric.label" class="hero-metric border-white/16 py-5 md:py-6" :class="{ 'border-r': index % 2 === 0 || index < 3, 'md:border-r-0': index === 3 }">
          <b class="block text-[clamp(1.35rem,2vw,1.9rem)] font-semibold leading-[1.1] tracking-[-.04em]">{{ metric.value }}</b>
          <span class="mt-2 block font-mono text-[.7rem] uppercase leading-snug tracking-[.06em] text-white/50">{{ metric.label }}</span>
        </div>
      </div>
    </div>

    <div class="hero-side-note" aria-hidden="true">{{ t('hero.side_note') }}</div>
  </section>
</template>

<style scoped>
.cosmos-hero { color: #f7f9ff; background: #02050c; }
.hero-wash {
  position: absolute; z-index: 0; inset: 0 40% 0 0;
  opacity: .3;
  background-position: center; background-size: cover;
  filter: grayscale(.4) contrast(1.1);
  -webkit-mask-image: linear-gradient(90deg, rgba(0,0,0,.9), transparent 95%), linear-gradient(0deg, transparent, #000 25%, #000 80%, transparent);
  -webkit-mask-composite: source-in;
  mask-image: linear-gradient(90deg, rgba(0,0,0,.9), transparent 95%), linear-gradient(0deg, transparent, #000 25%, #000 80%, transparent);
  mask-composite: intersect;
  pointer-events: none;
}
.hero-grid {
  display: grid; gap: 3rem; align-items: center;
  padding: clamp(2.5rem, 6vw, 5rem) 0 clamp(2.5rem, 5vw, 4rem);
  min-height: calc(100svh - 12rem);
}
@media (min-width: 1024px) {
  .hero-grid { grid-template-columns: minmax(0, 1.05fr) minmax(0, .95fr); gap: clamp(2.5rem, 5vw, 6rem); }
}
.hero-copy { min-width: 0; }
.hero-console { min-width: 0; }

.hero-title {
  max-width: 11ch; color: #f7f9ff;
  font-family: 'Space Grotesk', 'Noto Sans SC', system-ui, sans-serif;
  font-size: clamp(3.4rem, 6vw, 6.4rem); font-weight: 600; letter-spacing: -.065em; line-height: .92; text-wrap: balance;
}
.hero-title-line { display: block; }
.hero-title-zh { font-size: clamp(3.2rem, 5.6vw, 5.8rem); line-height: 1.04; }

.hero-action {
  display: inline-flex; min-width: 11.5rem; min-height: 48px; align-items: center; justify-content: space-between;
  border: 1px solid rgba(217,229,255,.48); padding: .8rem 1rem; color: #f7f9ff; background: rgba(2,8,20,.46);
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .75rem; letter-spacing: .11em; text-transform: uppercase;
  transition: color .2s ease, background .2s ease, border-color .2s ease;
}
.hero-action:hover { color: #06102a; border-color: #f7f9ff; background: #f7f9ff; }
.hero-action-primary { color: #ffffff; border-color: #315efb; background: #315efb; }

.phase-strip {
  display: grid; gap: 0; border-top: 1px solid rgba(255,255,255,.25); border-bottom: 1px solid rgba(255,255,255,.25);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}
.phase-strip > div { display: flex; flex-direction: column; justify-content: center; padding: .9rem 0; min-width: 0; }
.phase-strip-now { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; border-bottom: 1px solid rgba(255,255,255,.12); }
.phase-strip-label { font-size: .64rem; letter-spacing: .14em; text-transform: uppercase; color: rgba(255,255,255,.5); }
.phase-countdown { display: flex; gap: 1.25rem; margin-top: .45rem; font-variant-numeric: tabular-nums; }
.phase-countdown span { display: flex; align-items: baseline; gap: .35rem; }
.phase-countdown b { font-size: 1.35rem; font-weight: 500; letter-spacing: -.02em; color: #f5f5f5; }
.phase-countdown small { font-size: .62rem; letter-spacing: .1em; text-transform: uppercase; color: rgba(255,255,255,.45); }
@media (min-width: 768px) {
  .phase-strip { grid-template-columns: auto 1fr; }
  .phase-strip-now { border-bottom: 0; border-right: 1px solid rgba(255,255,255,.12); padding-right: 1.5rem; }
  .phase-strip-next { padding-left: 1.5rem; }
}

.hero-metrics > div { padding-left: clamp(.65rem, 2vw, 1.5rem); padding-right: clamp(.65rem, 2vw, 1.5rem); }
.hero-metrics > div:first-child { padding-left: 0; }
@media (max-width: 767px) {
  .hero-metrics > div:nth-child(odd) { padding-left: 0; }
  .hero-metrics > div:nth-child(even) { border-right: 0; }
  .hero-metrics > div:nth-child(-n+2) { border-bottom: 1px solid rgba(255,255,255,.16); }
}

.hero-side-note {
  position: absolute; z-index: 3; top: 50%; right: -8.4rem;
  color: rgba(255,255,255,.4); font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: .75rem; letter-spacing: .18em; text-transform: uppercase; transform: rotate(90deg);
}
@media (max-width: 1699px) { .hero-side-note { display: none; } }
@media (max-width: 1023px) {
  .hero-wash { inset: 0; opacity: .22; }
  .hero-grid { min-height: 0; }
}
@media (max-width: 720px) {
  .hero-title { font-size: clamp(3rem, 15vw, 4.5rem); }
  .hero-title-zh { font-size: clamp(2.8rem, 14vw, 4rem); }
  .hero-action { min-width: calc(50% - .4rem); }
  .phase-countdown { gap: .9rem; }
}
</style>
