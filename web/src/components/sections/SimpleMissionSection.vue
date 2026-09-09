<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import instrumentImage from '../../assets/images/cosmos-instrument.jpg'

const { t, pick } = useI18n()
type Card = { title: string; desc: string }
const cards = computed(() => t('home.mission.cards') as Card[])
</script>

<template>
  <section id="mission" class="poster-section poster-canvas py-24 md:py-40">
    <div class="mission-aura plasma-field" aria-hidden="true"></div>
    <div class="mx-auto max-w-[1600px] px-5 md:px-10 xl:px-14">
      <div class="grid gap-14 lg:grid-cols-[.85fr_1.15fr] lg:gap-24">
        <div class="reveal relative z-10 lg:sticky lg:top-28 lg:self-start">
          <div class="flex items-start justify-between">
            <span class="poster-kicker">{{ t('home.mission.kicker') }}</span>
            <span class="font-mono text-xs uppercase tracking-[.1em] text-[#315efb]">02 / 04</span>
          </div>
          <h2 class="section-title distressed-type mt-10">{{ t('home.mission.title') }}</h2>
          <p class="mt-7 max-w-xl text-base leading-relaxed text-text-secondary md:text-lg">{{ t('home.mission.lede') }}</p>

          <div class="mission-900 mt-14 border-y poster-rule py-8">
            <div class="text-[clamp(3rem,6.5vw,6.75rem)] font-semibold leading-[1.02] tracking-[-.055em] text-[#f5f5f5]">900</div>
            <div class="mt-7 flex justify-between font-mono text-xs uppercase tracking-[.1em] text-[#315efb]">
              <span>{{ pick('seconds', '秒') }}</span>
              <span>{{ pick('one decision', '一次决策') }}</span>
            </div>
          </div>
        </div>

        <div class="relative z-10">
          <div class="mission-photo photo-wash reveal mb-12 h-[300px] md:h-[440px]">
            <img :src="instrumentImage" alt="" loading="lazy">
            <span>{{ pick('INSTRUMENT CALIBRATION / HUMAN OVERSIGHT', '仪器标定 / 人类监督') }}</span>
          </div>
          <article v-for="(card, index) in cards" :key="card.title" class="poster-card reveal py-9 md:grid md:grid-cols-[5rem_1fr] md:gap-8 md:py-12" :class="`reveal-delay-${index + 1}`">
            <span class="font-mono text-xs text-[#315efb]">0{{ index + 1 }}</span>
            <div class="mt-5 md:mt-0">
              <h3 class="max-w-[18ch] text-xl font-semibold leading-tight tracking-[-.03em] text-[#f5f5f5] md:text-2xl">{{ card.title }}</h3>
              <p class="mt-4 max-w-xl text-sm leading-relaxed text-text-secondary">{{ card.desc }}</p>
            </div>
          </article>

          <div class="reveal mt-12 paper-sheet p-7 md:p-10">
            <span class="font-mono text-xs uppercase tracking-[.1em] text-[#315efb]">{{ pick('Entry requirement', '参赛要求') }}</span>
            <p class="relative z-10 mt-5 max-w-[22ch] text-xl font-semibold leading-relaxed tracking-[-.02em] md:text-3xl">{{ t('home.mission.closing') }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mission-aura { top: 35%; left: -26rem; width: 55rem; opacity: .38; transform: rotate(72deg); }
.mission-photo { box-shadow: 8px 8px 0 #315efb; }
.mission-photo img { object-position: 58% center; }
.mission-photo::after { background: linear-gradient(90deg, rgba(7,7,8,.48), transparent 48%), linear-gradient(0deg, rgba(7,7,8,.65), transparent 45%); }
.mission-photo span { position: absolute; z-index: 3; right: 1rem; bottom: 1rem; color: rgba(255,255,255,.72); font-family: 'IBM Plex Mono', monospace; font-size: .875rem; letter-spacing: .1em; }
.mission-900 { position: relative; }
.mission-900::after {
  position: absolute;
  top: 27%;
  right: 4%;
  width: 7rem;
  height: 7rem;
  border: 1px solid rgba(49,94,251,.6);
  border-radius: 50% !important;
  content: '';
  box-shadow: 0 0 0 1.4rem rgba(49,94,251,.1), 0 0 0 2.8rem rgba(49,94,251,.05);
}
</style>
