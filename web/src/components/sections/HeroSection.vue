<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { assetUrl } from '../../composables/api'
import { useAuth } from '../../stores/auth'
import { useRegistrationOpen } from '../../composables/useRegistrationOpen'

const { t, locale } = useI18n()
const { isLoggedIn } = useAuth()
const { registrationOpen } = useRegistrationOpen()
type Metric = { value: string; label: string }
const metrics = computed(() => t('hero.metrics') as Metric[])
const heroTitleLines = computed(() => locale.value === 'zh'
  ? ['巡天智能体']
  : ['Agent Observer'])
</script>

<template>
  <section id="top" class="hero-section cosmos-hero poster-canvas">
    <div
      class="hero-media"
      aria-hidden="true"
      :style="{ backgroundImage: `url(${assetUrl('/media/survey-milky-way.jpg')})` }"
    >
      <video autoplay loop muted playsinline preload="metadata" :poster="assetUrl('/media/survey-milky-way.jpg')">
        <source :src="assetUrl('/media/survey-night-sky.mp4')" type="video/mp4">
      </video>
    </div>
    <div class="hero-overlay" aria-hidden="true"></div>

    <div class="hero-layout relative z-10 mx-auto flex min-h-[calc(100svh-4rem)] max-w-[1600px] flex-col px-5 md:px-10 xl:px-14">
      <div class="hero-stage flex flex-1 items-center py-10">
        <div class="hero-copy">
          <div class="hero-kicker mb-7 flex items-center gap-4 font-mono text-xs uppercase leading-relaxed tracking-[.12em] text-[#78a6ff] md:text-sm">
            <span class="live-dot h-2 w-2 bg-[#78a6ff]"></span>
            {{ t('hero.eyebrow') }}
          </div>

          <h1 class="hero-title" :class="{ 'hero-title-zh': locale === 'zh' }" :aria-label="t('hero.system')">
            <span v-for="line in heroTitleLines" :key="line" class="hero-title-line">{{ line }}</span>
          </h1>
          <p class="hero-subtitle mt-4 font-mono text-sm uppercase tracking-[.22em] text-[#78a6ff] md:text-base">{{ t('hero.subtitle') }}</p>

          <div class="hero-intro mt-8 max-w-3xl border-t border-white/25 pt-6">
            <p class="text-base leading-[1.75] text-white/82 md:text-lg">{{ t('hero.lede') }}</p>
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
          </div>
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
.cosmos-hero {
  min-height: 760px;
  color: #f7f9ff;
  background: #02050c;
}

.hero-media {
  position: absolute;
  z-index: 0;
  inset: 0;
  background-color: #02050c;
  background-position: center bottom;
  background-size: cover;
}

.hero-media video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center bottom;
  filter: saturate(1.16) contrast(1.06) brightness(.94);
}

.hero-media::after {
  position: absolute;
  inset: 0;
  content: '';
  background:
    linear-gradient(90deg, rgba(2,5,14,.9) 0%, rgba(3,10,25,.62) 42%, rgba(2,6,16,.12) 76%, rgba(2,5,14,.24) 100%),
    linear-gradient(0deg, rgba(2,5,14,.72) 0%, rgba(2,5,14,.1) 54%, rgba(2,5,14,.3) 100%);
}

.hero-overlay {
  position: absolute;
  z-index: 1;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 62% 34%, rgba(70,126,255,.1), transparent 27%),
    linear-gradient(180deg, transparent 72%, rgba(2,5,14,.4));
}

.hero-layout { min-height: max(760px, calc(100svh - 4rem)); }
.hero-copy { max-width: 850px; }

.hero-title {
  max-width: 11ch;
  color: #f7f9ff;
  font-family: 'Space Grotesk', 'Noto Sans SC', system-ui, sans-serif;
  font-size: clamp(4rem, 7.6vw, 8rem);
  font-weight: 600;
  letter-spacing: -.065em;
  line-height: .92;
  text-wrap: balance;
}

.hero-title-line { display: block; }
.hero-title-zh {
  font-size: clamp(3.6rem, 6.6vw, 7rem);
  line-height: 1.04;
  letter-spacing: -.065em;
}
.hero-title-zh + .hero-subtitle { margin-top: 1.5rem; }

.hero-action {
  display: inline-flex;
  min-width: 11.5rem;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  border: 1px solid rgba(217,229,255,.48);
  padding: .8rem 1rem;
  color: #f7f9ff;
  background: rgba(2,8,20,.46);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: .75rem;
  letter-spacing: .11em;
  text-transform: uppercase;
  transition: color .2s ease, background .2s ease, border-color .2s ease;
}

.hero-action:hover { color: #06102a; border-color: #f7f9ff; background: #f7f9ff; }
.hero-action-primary { color: #ffffff; border-color: #315efb; background: #315efb; }
.hero-metrics > div { padding-left: clamp(.65rem, 2vw, 1.5rem); padding-right: clamp(.65rem, 2vw, 1.5rem); }
.hero-metrics > div:first-child { padding-left: 0; }
@media (max-width: 767px) {
  .hero-metrics > div:nth-child(odd) { padding-left: 0; }
  .hero-metrics > div:nth-child(even) { border-right: 0; }
  .hero-metrics > div:nth-child(-n+2) { border-bottom: 1px solid rgba(255,255,255,.16); }
}

.hero-side-note {
  position: absolute;
  z-index: 3;
  top: 50%;
  right: -8.4rem;
  color: rgba(255,255,255,.4);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: .75rem;
  letter-spacing: .18em;
  text-transform: uppercase;
  transform: rotate(90deg);
}

@media (max-width: 1023px) {
  .hero-stage { align-items: end; }
  .hero-title { max-width: 12ch; font-size: clamp(3.8rem, 12vw, 7rem); }
  .hero-side-note { display: none; }
}

@media (max-width: 720px) {
  .cosmos-hero { min-height: 900px; }
  .hero-layout { min-height: 900px; }
  .hero-media video { object-position: center bottom; }
  .hero-media::after {
    background:
      linear-gradient(90deg, rgba(2,5,14,.82), rgba(2,7,18,.28)),
      linear-gradient(0deg, rgba(2,5,14,.78), transparent 58%, rgba(2,5,14,.34));
  }
  .hero-stage { gap: 2rem; padding-top: 2rem; }
  .hero-title { font-size: clamp(3.6rem, 18vw, 5.5rem); }
  .hero-title-zh { font-size: clamp(3.15rem, 16vw, 4.75rem); line-height: 1.04; }
  .hero-intro { margin-top: 1.5rem; padding-top: 1.25rem; }
  .hero-action { min-width: calc(50% - .4rem); }
}
</style>
