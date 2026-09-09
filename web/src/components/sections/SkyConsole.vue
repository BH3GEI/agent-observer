<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { replayActions, replaySite, replaySlots, replayTiles, replayTimeAt, useReplayClock, SLOT_SECONDS } from '../../composables/useReplayClock'
import { drawSkyMap, type ObservedMark } from '../../lib/skymap'
import { fmtUtc, num } from '../../lib/format'

const { t } = useI18n()
const clock = useReplayClock()
const canvas = ref<HTMLCanvasElement | null>(null)
const hud = ref({ slot: '', night: '', date: '', utc: '', seeing: 0, transp: 0, sky: 0, open: true, score: 0, completed: 0 })
const paused = computed(() => clock.state.paused)
const reduced = computed(() => clock.state.reduced)
let raf = 0, observer: ResizeObserver | undefined, shownScore = 0, lastProgress = 0
const PULSE = SLOT_SECONDS * 0.8  // 45 s loop → 1 real second ≈ 480 replay seconds

function frameAt(progress: number) {
  const { slotIndex, nowSec } = replayTimeAt(progress)
  const observed = new Map<string, ObservedMark>()
  let score = 0, completed = 0
  for (const a of replayActions) {
    if (a.a !== 'observe' || !a.tile || a.startSec > nowSec) continue
    if (!observed.has(a.tile) || a.valid) observed.set(a.tile, { valid: a.valid, doneSec: a.startSec })
    if (a.valid) { score += a.score; completed++ }
  }
  return { slotIndex, nowSec, observed, score, completed }
}

function render() {
  const progress = clock.replayProgress()
  const { slotIndex, nowSec, observed, score, completed } = frameAt(progress)
  if (progress < lastProgress) shownScore = 0  // loop restarted
  lastProgress = progress
  shownScore = reduced.value ? score : shownScore + (score - shownScore) * 0.18
  const slot = replaySlots[slotIndex]!
  const stamp = fmtUtc(new Date(nowSec * 1000).toISOString(), { seconds: true, short: true })
  hud.value = { slot: slot.slot, night: slot.night, date: stamp.slice(0, 5), utc: stamp.slice(6), seeing: slot.seeing, transp: slot.transp, sky: slot.sky, open: slot.open, score: shownScore, completed }
  if (canvas.value) drawSkyMap(canvas.value, replayTiles, replaySite, { nowSec, observed, pulseSeconds: reduced.value ? 0 : PULSE })
}
function loop() { render(); if (!reduced.value) raf = requestAnimationFrame(loop) }

onMounted(() => {
  if (canvas.value) { observer = new ResizeObserver(() => render()); observer.observe(canvas.value) }
  loop()
})
onUnmounted(() => { cancelAnimationFrame(raf); observer?.disconnect() })
</script>

<template>
  <div class="sky-console" data-testid="sky-console" @mouseenter="clock.setPaused(true)" @mouseleave="clock.setPaused(false)">
    <div class="sky-console-head">
      <span class="flex items-center gap-3"><span class="live-dot" :class="{ 'is-paused': paused || reduced }"></span>{{ t('hero.console.title') }}</span>
      <span class="text-white/60">{{ paused ? t('hero.console.paused') : t('hero.console.replay_note') }}</span>
    </div>
    <canvas ref="canvas" class="sky-canvas" role="img" :aria-label="t('hero.console.aria')"></canvas>
    <div class="sky-legend" aria-hidden="true">
      <span><i style="border-color:#315efb"></i>DARK</span>
      <span><i style="border-color:#f5f5f5"></i>BRIGHT</span>
      <span><i style="border-color:#7a7a7a;opacity:.6"></i>BACKUP</span>
      <span><i class="ring"></i>{{ t('hero.console.legend_visible') }}</span>
      <span><i class="meridian"></i>{{ t('hero.console.legend_meridian') }}</span>
    </div>
    <dl class="sky-hud" aria-live="off">
      <div><dt>{{ t('hero.console.slot') }}</dt><dd data-testid="sky-slot">{{ hud.slot }}</dd></div>
      <div><dt>UTC {{ hud.date }}</dt><dd>{{ hud.utc }}</dd></div>
      <div class="sky-hud-weather">
        <dt>{{ t('hero.console.weather') }}</dt>
        <dd v-if="hud.open">{{ num(hud.seeing, 2) }}″ · {{ num(hud.transp, 2) }} · {{ num(hud.sky, 2) }}</dd>
        <dd v-else class="text-[#ff6b6b]">{{ t('hero.console.dome_closed') }}</dd>
      </div>
      <div><dt>{{ t('hero.console.score') }}</dt><dd class="text-[#78a6ff]">{{ num(hud.score, 1) }}</dd></div>
      <div><dt>{{ t('hero.console.tiles') }}</dt><dd>{{ hud.completed }} / {{ replayTiles.length }}</dd></div>
    </dl>
  </div>
</template>

<style scoped>
.sky-console {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255,255,255,.28);
  background: rgba(2,5,12,.72);
}
.sky-console::before {
  position: absolute; top: -1px; left: 0; width: 3.5rem; height: 2px; content: ''; background: #315efb;
}
.sky-console-head {
  display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap;
  padding: .7rem .9rem;
  border-bottom: 1px solid rgba(255,255,255,.16);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: .68rem; letter-spacing: .12em; text-transform: uppercase; color: #a8a8a8;
}
.live-dot.is-paused { animation: none; opacity: .5; }
.sky-canvas { display: block; width: 100%; aspect-ratio: 3 / 2; min-height: 200px; }
.sky-legend {
  display: flex; flex-wrap: wrap; gap: .4rem 1.1rem;
  padding: .45rem .9rem;
  border-top: 1px solid rgba(255,255,255,.1);
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: .62rem; letter-spacing: .1em; text-transform: uppercase; color: rgba(255,255,255,.5);
}
.sky-legend i { display: inline-block; width: .55rem; height: .55rem; margin-right: .4rem; border: 1px solid; vertical-align: middle; }
.sky-legend i.ring { border-color: rgba(255,255,255,.5); border-radius: 50%; }
.sky-legend i.meridian { width: 0; height: .7rem; border-width: 0 0 0 1px; border-style: dashed; border-color: #315efb; }
.sky-hud {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0;
  margin: 0; border-top: 1px solid rgba(255,255,255,.16);
  font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums;
}
.sky-hud > div { min-width: 0; padding: .6rem .9rem; border-right: 1px solid rgba(255,255,255,.1); border-bottom: 1px solid rgba(255,255,255,.1); }
.sky-hud dt { font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: rgba(255,255,255,.45); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sky-hud dd { margin: .15rem 0 0; font-size: .82rem; color: #f5f5f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sky-hud-weather { grid-column: span 2; }
@media (min-width: 640px) {
  .sky-hud { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .sky-hud-weather { grid-column: span 2; }
  .sky-hud > div { border-bottom: 0; }
  .sky-hud > div:last-child { border-right: 0; }
}
</style>
