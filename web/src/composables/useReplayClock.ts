import { onMounted, onUnmounted, reactive, readonly } from 'vue'
import replay from '../content/demo/replay.json'
import { prefersReducedMotion } from '../lib/skymap'

/**
 * One shared clock for the published demo replay (2 nights × 12 slots of 900 s).
 * Progress 0…1 maps linearly onto the 24 slots (night gaps are skipped), one loop ≈ 45 s.
 * The hero console and the footer slot ticker read the same clock, so they always agree.
 */
export interface ReplaySlot { slot: string; night: string; t: string; startSec: number; seeing: number; transp: number; sky: number; open: boolean }
export interface ReplayAction { i: number; slot: string; a: 'observe' | 'wait'; tile: string | null; valid: boolean; t: string; dt: number; score: number; startSec: number; doneSec: number }

export const LOOP_MS = 45_000
export const SLOT_SECONDS = 900
export const replaySite = replay.site
export const replayTiles = replay.tiles.map(t => ({ id: t.id, ra: t.ra, dec: t.dec, program: t.p === 'D' ? 'DARK' as const : t.p === 'B' ? 'BRIGHT' as const : 'BACKUP' as const }))
export const replaySlots: ReplaySlot[] = replay.weather.map(w => ({ ...w, startSec: Date.parse(w.t) / 1000 }))
export const replayActions: ReplayAction[] = replay.actions.map(a => {
  const startSec = Date.parse(a.t) / 1000
  return { ...a, a: a.a as 'observe' | 'wait', startSec, doneSec: startSec + a.dt }
})
export const replayTotals = { finalScore: replay.final_score, scienceScore: replay.science_score, completed: replay.completed }
const VIRTUAL_TOTAL = replaySlots.length * SLOT_SECONDS

const state = reactive({ progress: 0, slotIndex: 0, paused: false, reduced: false })
let base = 0, runningSince: number | null = null, users = 0, timer: number | undefined

function elapsedMs(): number {
  return base + (runningSince == null ? 0 : performance.now() - runningSince)
}
/** Continuous loop progress in [0, 1). Under reduced motion the clock sits at the final state. */
export function replayProgress(): number {
  if (state.reduced) return 0.999999
  return (elapsedMs() % LOOP_MS) / LOOP_MS
}
/** Map loop progress onto replay time (unix seconds) and slot index. */
export function replayTimeAt(progress: number): { slotIndex: number; nowSec: number; frac: number } {
  const v = Math.max(0, Math.min(VIRTUAL_TOTAL - 1e-6, progress * VIRTUAL_TOTAL))
  const slotIndex = Math.min(replaySlots.length - 1, Math.floor(v / SLOT_SECONDS))
  const frac = v / SLOT_SECONDS - slotIndex
  return { slotIndex, frac, nowSec: replaySlots[slotIndex]!.startSec + frac * SLOT_SECONDS }
}
function tick() {
  const p = replayProgress()
  state.progress = p
  state.slotIndex = replayTimeAt(p).slotIndex
}
function setPaused(paused: boolean) {
  if (state.paused === paused) return
  state.paused = paused
  if (paused) { base = elapsedMs(); runningSince = null }
  else runningSince = performance.now()
}
function acquire() {
  if (users++ > 0) return
  state.reduced = prefersReducedMotion()
  base = 0
  runningSince = state.reduced || state.paused ? null : performance.now()
  tick()
  timer = window.setInterval(tick, 250)
}
function release() {
  if (--users > 0) return
  if (timer) window.clearInterval(timer)
  timer = undefined
  runningSince = null
}

export function useReplayClock() {
  onMounted(acquire)
  onUnmounted(release)
  return { state: readonly(state), setPaused, replayProgress, replayTimeAt, slots: replaySlots }
}
