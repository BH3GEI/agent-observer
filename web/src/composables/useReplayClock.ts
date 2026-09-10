import { onMounted, onUnmounted, reactive, readonly } from 'vue'
import replay from '../content/demo/replay.json'
import { outcomeClass, type OutcomeClass } from '../lib/report'
import { prefersReducedMotion, type SkySite, type SkyTile } from '../lib/skymap'

/**
 * One shared clock for the published demo replay: a real 14-night run of the minimal agent
 * (548 committed actions, 537 slots). Loop progress 0…1 is mapped onto the *actions*, not onto
 * wall time: every observe gets a full share of the loop, every wait a small one, so long idle
 * runs (closed dome, nothing above 30°) flash by while exposures are visible. One loop ≈ 45 s.
 * The hero console and the footer slot ticker read the same clock, so they always agree.
 */
export interface ReplaySlot { slot: string; night: string; t: string; startSec: number; open: boolean; seeing: number; transp: number; sky: number; eff: number }
export interface ReplayAction {
  i: string; slot: string; a: 'observe' | 'wait'; tile: string; program: string; outcome: string; cls: OutcomeClass
  t: string; dt: number; score: number; penalty: number; startSec: number; doneSec: number
}

export const LOOP_MS = 45_000
export const SLOT_SECONDS = 900
const WAIT_WEIGHT = 0.12
export const replaySite: SkySite = replay.site
export const replayTiles: SkyTile[] = replay.tiles.map(t => ({ id: t.id, ra: t.ra, dec: t.dec, cls: t.cls === 'R' ? 'R' as const : 'F' as const, region: t.region, exp: t.exp }))
export const replaySlots: ReplaySlot[] = replay.weather.map(w => ({ ...w, startSec: Date.parse(w.t) / 1000 }))
export const replayActions: ReplayAction[] = replay.actions.map(a => {
  const startSec = Date.parse(a.t) / 1000
  const act = a.a === 'wait' ? 'wait' as const : 'observe' as const
  return { ...a, a: act, cls: outcomeClass(a.outcome, act), startSec, doneSec: startSec + a.dt }
})
export const replayTotals = { finalScore: replay.score.total, baseScience: replay.score.base_science, completed: replay.completed, nights: replay.nights, requiredMissing: replay.required_missing.length }

// cumulative loop weights: action k spans [cum[k], cum[k+1]) of the loop
const weights = replayActions.map(a => (a.a === 'wait' ? WAIT_WEIGHT : 1))
const cum: number[] = [0]
for (const w of weights) cum.push(cum[cum.length - 1]! + w)
const TOTAL_WEIGHT = cum[cum.length - 1]!

const state = reactive({ progress: 0, slotIndex: 0, actionIndex: 0, paused: false, reduced: false })
let base = 0, runningSince: number | null = null, users = 0, timer: number | undefined

function elapsedMs(): number {
  return base + (runningSince == null ? 0 : performance.now() - runningSince)
}
/** Continuous loop progress in [0, 1). Under reduced motion the clock sits at the final state. */
export function replayProgress(): number {
  if (state.reduced) return 0.999999
  return (elapsedMs() % LOOP_MS) / LOOP_MS
}
/** Slot containing a replay time (binary search over slot start times). */
export function slotIndexAt(nowSec: number): number {
  let lo = 0, hi = replaySlots.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (replaySlots[mid]!.startSec <= nowSec) lo = mid; else hi = mid - 1
  }
  return lo
}
/** Map loop progress onto the current action, replay time (unix seconds) and slot index. */
export function replayTimeAt(progress: number): { actionIndex: number; slotIndex: number; nowSec: number; frac: number } {
  const v = Math.max(0, Math.min(TOTAL_WEIGHT - 1e-9, progress * TOTAL_WEIGHT))
  let lo = 0, hi = replayActions.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (cum[mid]! <= v) lo = mid; else hi = mid - 1
  }
  const frac = (v - cum[lo]!) / weights[lo]!
  const a = replayActions[lo]!
  const nowSec = a.startSec + frac * Math.max(1, a.dt)
  return { actionIndex: lo, slotIndex: slotIndexAt(nowSec), nowSec, frac }
}
function tick() {
  const p = replayProgress()
  const at = replayTimeAt(p)
  state.progress = p
  state.slotIndex = at.slotIndex
  state.actionIndex = at.actionIndex
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
  return { state: readonly(state), setPaused, replayProgress, replayTimeAt, slots: replaySlots, actions: replayActions }
}
