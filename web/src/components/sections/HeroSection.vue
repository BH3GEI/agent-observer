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
// Milestones of the event, shown as a horizontal timeline under the phase strip.
type Stage = { label: string; date: string; note?: string }
const stages = computed(() => t('hero.pipeline') as Stage[])
</script>

<template>
  <section id="top" class="hero-section cosmos-hero poster-canvas">
    <div class="hero-wash" aria-hidden="true">
      <video
        class="hero-wash-video parallax-bg"
        autoplay muted loop playsinline
        preload="auto"
        :poster="assetUrl('/media/survey-milky-way.jpg')"
      >
        <source :src="assetUrl('/media/survey-night-sky.mp4')" type="video/mp4">
      </video>
    </div>
    <div class="hero-grid-lines" aria-hidden="true"></div>
    <div class="hero-beam" aria-hidden="true"></div>

    <div class="relative z-10 mx-auto max-w-[1600px] px-5 md:px-10 xl:px-14">
      <div class="hero-grid">
        <div class="hero-copy">
          <div class="hero-kicker mb-6 flex items-center gap-4 font-mono text-xs uppercase leading-relaxed tracking-[.12em] text-[#78a6ff] md:text-sm reveal">
            <span class="live-dot h-2 w-2 bg-[#78a6ff]"></span>
            {{ t('hero.eyebrow') }}
          </div>

          <h1 class="hero-title reveal reveal-delay-1" :class="{ 'hero-title-zh': locale === 'zh' }" :aria-label="t('hero.system')">
            <span v-for="line in heroTitleLines" :key="line" class="hero-title-line">{{ line }}</span>
          </h1>
          <p class="hero-subtitle mt-3 font-mono text-sm uppercase tracking-[.22em] text-[#78a6ff] reveal reveal-delay-2">{{ t('hero.subtitle') }}</p>

          <p class="mt-7 max-w-xl text-base leading-[1.75] text-white/82 md:text-lg reveal reveal-delay-3">{{ t('hero.lede') }}</p>
          <div class="mt-7 flex flex-wrap gap-3 reveal reveal-delay-4">
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

          <div class="phase-strip phase-strip-live mt-9 reveal reveal-delay-5" data-testid="phase-strip">
            <div class="phase-strip-now">
              <span class="phase-strip-label">{{ t('phase_clock.now') }}</span>
              <span v-if="current" class="pill open">{{ pick(current.name_en, current.name_zh) }} · {{ t('leaderboard.status.open') }}</span>
              <span v-else-if="loaded" class="pill">{{ t('phase_clock.no_open') }}</span>
              <span v-else class="pill" aria-busy="true">…</span>
            </div>
            <div class="phase-strip-next">
              <span class="phase-strip-label">{{ t('phase_clock.next') }} · {{ loaded ? nextName : '…' }}<template v-if="nextStartsAt"> · {{ fmtUtc(nextStartsAt) }} UTC</template></span>
              <div v-if="nextStartsAt" class="phase-countdown" role="timer" :aria-label="t('phase_clock.countdown_aria')">
                <span v-for="p in parts" :key="p.l"><b class="phase-countdown-value">{{ p.v }}</b><small>{{ p.l }}</small></span>
              </div>
            </div>
          </div>
          <ol class="hero-timeline mt-9 reveal reveal-delay-5" data-testid="hero-timeline">
            <li v-for="(stage, i) in stages" :key="stage.label">
              <span class="hero-timeline-step">0{{ i + 1 }}</span>
              <span class="hero-timeline-label">{{ stage.label }}</span>
              <span class="hero-timeline-date">{{ stage.date }}</span>
              <span v-if="stage.note" class="hero-timeline-note">{{ stage.note }}</span>
            </li>
          </ol>
        </div>

        <div class="hero-console reveal reveal-delay-2">
          <SkyConsole />
        </div>
      </div>

      <div class="hero-metrics hero-metrics-strong grid grid-cols-2 border-t border-white/22 md:grid-cols-4 reveal reveal-delay-3">
        <div v-for="(metric, index) in metrics" :key="metric.label" class="hero-metric border-white/16 py-5 md:py-6" :class="{ 'border-r': index % 2 === 0 || index < 3, 'md:border-r-0': index === 3 }">
          <b class="hero-metric-value block text-[clamp(1.7rem,2.8vw,2.6rem)] font-semibold leading-[1.05] tracking-[-.04em]">{{ metric.value }}</b>
          <span class="mt-2 block font-mono text-[.7rem] uppercase leading-snug tracking-[.06em] text-white/50">{{ metric.label }}</span>
        </div>
      </div>
    </div>

    <div class="hero-side-note" aria-hidden="true">{{ t('hero.side_note') }}</div>
  </section>
</template>

<style scoped>
.cosmos-hero {
  color: #f7f9ff;
  background:
    radial-gradient(circle at 18% 20%, rgba(49,94,251,.32), transparent 26%),
    radial-gradient(circle at 82% 12%, rgba(139,92,246,.2), transparent 24%),
    radial-gradient(circle at 62% 88%, rgba(34,211,238,.14), transparent 30%),
    linear-gradient(180deg, #02050c 0%, #060a16 58%, #030612 100%);
}
.hero-wash {
  position: absolute; z-index: 0; inset: 0; pointer-events: none;
}
.hero-wash::after {
  position: absolute; inset: 0; content: '';
  background: linear-gradient(90deg, rgba(2,5,12,.7) 0%, rgba(2,5,12,.34) 46%, rgba(2,5,12,.72) 100%),
    linear-gradient(0deg, rgba(2,5,12,.92), transparent 38%, transparent 76%, rgba(2,5,12,.7));
}
.hero-wash-video {
  width: 100%; height: 100%; object-fit: cover;
  opacity: .55;
  filter: saturate(1.15) contrast(1.24) brightness(1.08);
  transform: translate3d(0, var(--parallax-y, 0px), 0) scale(1.08);
  transition: transform .18s linear;
}
.hero-beam {
  position: absolute; z-index: 1; top: 0; bottom: 0; left: 34%; width: 34rem; pointer-events: none;
  background: linear-gradient(100deg, transparent, rgba(120,166,255,.12), transparent);
  transform: translateX(-60%);
  animation: hero-beam-sweep 9s ease-in-out infinite;
}
@keyframes hero-beam-sweep {
  0%, 100% { transform: translateX(-70%); opacity: 0; }
  35% { opacity: 1; }
  55% { transform: translateX(130%); opacity: 0; }
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
  background: linear-gradient(97deg, #ffffff 6%, #bccbff 40%, #d8c3ff 66%, #8fd9ff 96%);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.hero-title-line { display: block; }
.hero-title-zh { font-size: clamp(3.2rem, 5.6vw, 5.8rem); line-height: 1.04; }

.hero-action {
  position: relative;
  overflow: hidden;
  display: inline-flex; min-width: 11.5rem; min-height: 48px; align-items: center; justify-content: space-between;
  border: 1px solid rgba(217,229,255,.48); padding: .8rem 1rem; color: #f7f9ff; background: rgba(2,8,20,.46);
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .75rem; letter-spacing: .11em; text-transform: uppercase;
  transition: color .2s ease, background .2s ease, border-color .2s ease;
}
.hero-action:hover { color: #06102a; border-color: #f7f9ff; background: #f7f9ff; }
.hero-action-primary { color: #ffffff; border-color: #315efb; background: linear-gradient(92deg, #315efb, #7c5cff); }

.hero-grid-lines {
  position: absolute; z-index: 0; inset: 0; pointer-events: none; opacity: .16;
  background-image:
    linear-gradient(rgba(120,166,255,.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(120,166,255,.08) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: linear-gradient(180deg, transparent, #000 12%, #000 84%, transparent);
}

.phase-strip {
  display: grid; gap: 0; border-top: 1px solid rgba(255,255,255,.25); border-bottom: 1px solid rgba(255,255,255,.25);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
}
.phase-strip > div { display: flex; flex-direction: column; justify-content: center; padding: .9rem 0; min-width: 0; }
.phase-strip-now { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; border-bottom: 1px solid rgba(255,255,255,.12); }
.phase-strip-label { font-size: .64rem; letter-spacing: .14em; text-transform: uppercase; color: rgba(255,255,255,.5); }
.phase-countdown { display: flex; gap: 1.25rem; margin-top: .45rem; font-variant-numeric: tabular-nums; }
.phase-countdown span { display: flex; align-items: baseline; gap: .35rem; }
.phase-countdown-value {
  font-family: 'Space Grotesk', 'Noto Sans SC', system-ui, sans-serif;
  font-size: clamp(1.9rem, 3.4vw, 2.9rem); font-weight: 600; letter-spacing: -.04em; color: #f7f9ff;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 26px rgba(120,166,255,.42);
}
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

.hero-timeline-note { display: block; margin-top: .3rem; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .62rem; letter-spacing: .05em; color: rgba(190,205,255,.62); }
.hero-timeline {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0; padding: 0; list-style: none;
  border-top: 1px solid rgba(255,255,255,.25);
}
.hero-timeline li { position: relative; display: flex; flex-direction: column; gap: .3rem; padding: 1.1rem 1rem 0 0; }
.hero-timeline li::before {
  position: absolute; top: -5px; left: 0; width: 9px; height: 9px; content: '';
  background: #78a6ff; transform: rotate(45deg);
  box-shadow: 0 0 14px rgba(120,166,255,.6);
}
.hero-timeline li::after {
  position: absolute; top: -1px; left: 9px; right: 0; height: 1px; content: '';
  background: linear-gradient(90deg, rgba(120,166,255,.55), rgba(255,255,255,.14));
}
.hero-timeline-step { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .62rem; letter-spacing: .14em; color: #78a6ff; }
.hero-timeline-label { font-size: .95rem; font-weight: 600; letter-spacing: -.01em; color: #f7f9ff; }
.hero-timeline-date { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .66rem; letter-spacing: .08em; text-transform: uppercase; color: rgba(255,255,255,.55); }

.hero-metric-value { color: #f7f9ff; }
.hero-metrics-strong { border-top-color: rgba(255,255,255,.32); background: linear-gradient(180deg, rgba(49,94,251,.1), transparent 70%); }

.hero-side-note {
  position: absolute; z-index: 3; top: 50%; right: -8.4rem;
  color: rgba(255,255,255,.4); font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: .75rem; letter-spacing: .18em; text-transform: uppercase; transform: rotate(90deg);
}
@media (max-width: 1699px) { .hero-side-note { display: none; } }
@media (max-width: 1023px) {
  .hero-wash-video { opacity: .32; }
  .hero-grid { min-height: 0; }
  .hero-timeline-note { display: block; margin-top: .3rem; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .62rem; letter-spacing: .05em; color: rgba(190,205,255,.62); }
.hero-timeline { grid-template-columns: 1fr; }
  .hero-timeline li::after { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .hero-wash-video { transform: none; transition: none; }
  .hero-beam { display: none; }
  .hero-action::after { display: none; }
}

@media (max-width: 720px) {
  .hero-title { font-size: clamp(3rem, 15vw, 4.5rem); }
  .hero-title-zh { font-size: clamp(2.8rem, 14vw, 4rem); }
  .hero-action { min-width: calc(50% - .4rem); }
  .phase-countdown { gap: .9rem; }
}
</style>
