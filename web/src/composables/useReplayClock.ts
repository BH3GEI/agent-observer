import { onMounted, onUnmounted, reactive, readonly } from 'vue'
import demoReplay from '../content/demo/replay.json'
import { outcomeClass, type OutcomeClass } from '../lib/report'
import { prefersReducedMotion, type SkySite, type SkyTile } from '../lib/skymap'

/**
 * One shared clock for the replay the homepage console renders. It boots on the bundled demo run and is
 * swapped live for the current champion's real submission once that loads (setReplayData) — the arrays
 * below are live module bindings, so per-frame readers pick the swap up immediately; anything cached at
 * setup time should re-derive from replayMeta.version.
 *
 * Loop progress 0…1 maps LINEARLY onto night time: every 900-second slot owns an equal share of the
 * loop, so the replay advances at one steady pace with no fast-forward jumps. The daytime between two
 * nights is skipped at a slot boundary — the moment the sky visibly rotates, which the narration and
 * walkthrough call out.
 */
export interface ReplaySlot { slot: string; night: string; t: string; startSec: number; open: boolean; seeing: number; transp: number; sky: number; eff: number }
export interface ReplayAction {
  i: string; slot: string; a: 'observe' | 'wait'; tile: string; program: string; outcome: string; cls: OutcomeClass
  t: string; dt: number; score: number; penalty: number; startSec: number; doneSec: number
}
export interface RawReplayTile { id: string; ra: number; dec: number; cls: string; region: string; exp: number }
export interface RawReplaySlot { slot: string; night: string; t: string; open: boolean; seeing: number; transp: number; sky: number; eff: number }
export interface RawReplayAction { i: string; slot: string; a: string; tile: string; program: string; outcome: string; t: string; dt: number; score: number; penalty: number }
export interface RawReplay {
  site: SkySite
  tiles: RawReplayTile[]
  weather: RawReplaySlot[]
  actions: RawReplayAction[]
  score: { total: number; base_science: number }
  completed: number
  required_missing: string[]
  nights: number
}

export const LOOP_MS = 75_000
export const SLOT_SECONDS = 900

export const replayMeta = reactive({ version: 0, source: 'demo' as 'demo' | 'champion', label: '' })

export let replaySite: SkySite = { lat: 0, lon: 0, min_alt: 30 }
export let replayTiles: SkyTile[] = []
export let replaySlots: ReplaySlot[] = []
export let replayActions: ReplayAction[] = []
export let replayTotals = { finalScore: 0, baseScience: 0, completed: 0, nights: 0, requiredMissing: 0 }
export let replayNights: string[] = []
let actionStarts: number[] = []
let totalNightSec = 1

export function setReplayData(raw: RawReplay, source: 'demo' | 'champion' = 'demo', label = '') {
  replaySite = raw.site
  replayTiles = raw.tiles.map(t => ({ id: t.id, ra: t.ra, dec: t.dec, cls: t.cls === 'R' ? 'R' as const : 'F' as const, region: t.region, exp: t.exp }))
  replaySlots = raw.weather.map(w => ({ ...w, startSec: Date.parse(w.t) / 1000 }))
  replayActions = raw.actions.map(a => {
    const startSec = Date.parse(a.t) / 1000
    const act = a.a === 'wait' ? 'wait' as const : 'observe' as const
    return { ...a, a: act, cls: outcomeClass(a.outcome, act), startSec, doneSec: startSec + a.dt }
  })
  replayTotals = {
    finalScore: raw.score.total, baseScience: raw.score.base_science,
    completed: raw.completed, nights: raw.nights, requiredMissing: raw.required_missing.length,
  }
  replayNights = [...new Set(replaySlots.map(s => s.night))]
  actionStarts = replayActions.map(a => a.startSec)
  totalNightSec = Math.max(1, replaySlots.length * SLOT_SECONDS)
  replayMeta.source = source
  replayMeta.label = label
  replayMeta.version += 1
  tick()
}
setReplayData(demoReplay as unknown as RawReplay, 'demo')

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
/** Map loop progress onto replay time at one steady rate: progress spans the night slots uniformly. */
export function replayTimeAt(progress: number): { actionIndex: number; slotIndex: number; nowSec: number; frac: number; fastForward: boolean } {
  const g = Math.max(0, Math.min(0.999999, progress)) * totalNightSec
  const slotIndex = Math.min(replaySlots.length - 1, Math.floor(g / SLOT_SECONDS))
  const nowSec = replaySlots[slotIndex]!.startSec + (g - slotIndex * SLOT_SECONDS)
  let lo = 0, hi = replayActions.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (actionStarts[mid]! <= nowSec) lo = mid; else hi = mid - 1
  }
  const a = replayActions[lo]!
  const frac = Math.max(0, Math.min(1, (nowSec - a.startSec) / Math.max(1, a.dt)))
  return { actionIndex: lo, slotIndex, nowSec, frac, fastForward: false }
}
function tick() {
  const p = replayProgress()
  const at = replayTimeAt(p)
  state.progress = p
  state.slotIndex = at.slotIndex
  state.actionIndex = at.actionIndex
}
/** Jump the shared clock to a loop position (the console's drag bar). */
export function seekReplay(progress: number) {
  const p = Math.max(0, Math.min(0.999999, progress))
  base = p * LOOP_MS
  if (runningSince != null) runningSince = performance.now()
  tick()
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
  return { state: readonly(state), setPaused, seek: seekReplay, replayProgress, replayTimeAt }
}
