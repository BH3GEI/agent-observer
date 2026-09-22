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
 * Progress maps onto EVENTS, not onto wall-clock time. A real competition run is mostly waiting: the
 * current champion spends 7,854 of its 7,944 actions idle, so spreading the loop evenly over the 7,928
 * slots put every exposure on screen for about ten milliseconds and left the narration stuck on "waiting".
 * Instead each exposure now owns an equal, legible share of the loop, and each run of waiting between two
 * exposures — three slots or six hundred — collapses into one short beat that shows the sim time just
 * before the next exposure starts. The result is a steady pace where something visible happens throughout.
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

export const SLOT_SECONDS = 900

/** One exposure's share of the loop, and the share a whole run of waiting collapses into. */
const OBSERVE_UNIT = 1
const GAP_UNIT = 0.3
/**
 * Extra share a gap earns per full turn the sky has to travel across it. A gap over the daylight hours
 * moves the sky most of the way round, and it needs room to do that at a speed the eye can follow.
 */
const GAP_SWEEP_UNIT = 0.9
/** Real time each unit of weight is worth, and the bounds a full loop is kept inside. */
const MS_PER_UNIT = 760
const LOOP_MIN_MS = 45_000
const LOOP_MAX_MS = 115_000
/** How much sim time a collapsed gap actually shows: the quiet stretch just before the next exposure. */
const GAP_SHOWN_SLOTS = 3
/** One turn of the sky, used to keep a collapsed gap from sweeping the map round more than once. */
const SIDEREAL_DAY = 86164.0905

export const replayMeta = reactive({ version: 0, source: 'demo' as 'demo' | 'champion', label: '' })

export let replaySite: SkySite = { lat: 0, lon: 0, min_alt: 30 }
export let replayTiles: SkyTile[] = []
export let replaySlots: ReplaySlot[] = []
export let replayActions: ReplayAction[] = []
export let replayTotals = { finalScore: 0, baseScience: 0, completed: 0, nights: 0, requiredMissing: 0 }
export let replayNights: string[] = []
/** Only the exposures, with their index in replayActions — the console draws marks from these. */
export let replayObserves: { i: number; a: ReplayAction }[] = []
/** Running net score: replayNetPrefix[k] covers actions 0…k-1, so the console never scans the run. */
export let replayNetPrefix: number[] = [0]
export let LOOP_MS = 75_000

type Segment = {
  kind: 'observe' | 'gap'
  actionIndex: number
  fromSec: number
  toSec: number
  nights: number
  slots: number
  /** Where the sky starts from, so a gap sweeps across the skipped hours instead of cutting to its end. */
  sweepFromSec: number
  /** This segment's share of the loop. */
  weight: number
}
let segments: Segment[] = []
let segCum: number[] = [0]
let totalWeight = 1

const nightOf = (slotId: string) => slotId.split('-')[0] ?? ''

/**
 * Settle where a gap's sweep starts and what it costs. Whole turns are trimmed off first, so a gap of
 * several nights still crosses the map once; what is left decides how long the gap holds, which keeps
 * every sweep at roughly the same speed however many hours it stands for.
 */
function priceGap(seg: Segment, jumpFromSec: number): Segment {
  let from = jumpFromSec
  const span = seg.toSec - from
  if (span > SIDEREAL_DAY) from = seg.toSec - (span % SIDEREAL_DAY)
  const turn = Math.min(1, Math.max(0, (seg.toSec - from) / SIDEREAL_DAY))
  seg.sweepFromSec = from
  seg.weight = GAP_UNIT + turn * GAP_SWEEP_UNIT
  return seg
}

/**
 * A stretch of run time with no actions logged in it at all. Some runs stop writing rows while they
 * wait, so two exposures can sit hours apart with nothing between them; without a segment of its own
 * that stretch would cut the sky straight from one hour angle to another.
 */
function holeSegment(fromSec: number, toSec: number, actionIndex: number): Segment {
  const a = slotIndexAt(fromSec), b = slotIndexAt(toSec)
  const nights = new Set<string>()
  for (let k = Math.min(a, b); k <= Math.max(a, b); k++) {
    const slot = replaySlots[k]
    if (slot) nights.add(slot.night)
  }
  const shown = Math.min(toSec - fromSec, GAP_SHOWN_SLOTS * SLOT_SECONDS)
  return priceGap(
    { kind: 'gap', actionIndex, fromSec: toSec - shown, toSec, nights: nights.size, slots: Math.abs(b - a), sweepFromSec: fromSec, weight: GAP_UNIT },
    fromSec,
  )
}

function buildSegments() {
  segments = []
  let i = 0
  while (i < replayActions.length) {
    const action = replayActions[i]!
    if (action.a === 'observe') {
      const prev = segments[segments.length - 1]
      if (prev && action.startSec - prev.toSec > SLOT_SECONDS) {
        segments.push(holeSegment(prev.toSec, action.startSec, i))
      }
      segments.push({ kind: 'observe', actionIndex: i, fromSec: action.startSec, toSec: action.doneSec, nights: 0, slots: 0, sweepFromSec: action.startSec, weight: OBSERVE_UNIT })
      i += 1
      continue
    }
    const start = i
    const nights = new Set<string>()
    while (i < replayActions.length && replayActions[i]!.a !== 'observe') {
      nights.add(nightOf(replayActions[i]!.slot))
      i += 1
    }
    const last = replayActions[i - 1]!
    const endSec = i < replayActions.length ? replayActions[i]!.startSec : last.doneSec
    const shown = Math.min(Math.max(0, endSec - replayActions[start]!.startSec), GAP_SHOWN_SLOTS * SLOT_SECONDS)
    const prev = segments[segments.length - 1]
    segments.push(priceGap(
      {
        kind: 'gap',
        actionIndex: start,
        fromSec: endSec - shown,
        toSec: endSec,
        nights: nights.size,
        slots: i - start,
        sweepFromSec: endSec - shown,
        weight: GAP_UNIT,
      },
      prev ? prev.toSec : endSec - shown,
    ))
  }
  if (!segments.length) {
    segments.push({ kind: 'gap', actionIndex: 0, fromSec: 0, toSec: 1, nights: 0, slots: 0, sweepFromSec: 0, weight: GAP_UNIT })
  }
  segCum = [0]
  for (const seg of segments) segCum.push(segCum[segCum.length - 1]! + seg.weight)
  totalWeight = Math.max(1e-6, segCum[segCum.length - 1]!)
  LOOP_MS = Math.min(LOOP_MAX_MS, Math.max(LOOP_MIN_MS, Math.round(totalWeight * MS_PER_UNIT)))
}

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
  replayObserves = replayActions.map((a, i) => ({ i, a })).filter(entry => entry.a.a === 'observe')
  replayNetPrefix = [0]
  for (const a of replayActions) replayNetPrefix.push(replayNetPrefix[replayNetPrefix.length - 1]! + a.score - a.penalty)
  buildSegments()
  replayMeta.source = source
  replayMeta.label = label
  replayMeta.version += 1
  tick()
}

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

export interface ReplayFrame {
  actionIndex: number
  slotIndex: number
  nowSec: number
  /**
   * Time to draw the sky at. Equal to nowSec during an exposure. Across a collapsed gap it sweeps
   * the whole skipped stretch instead, so the meridian and the visibility rings travel there rather
   * than reappearing half a turn away.
   */
  skySec: number
  frac: number
  /** Set while a run of waiting is being shown, with how much of the run it stands for. */
  gap: { nights: number; slots: number } | null
}
/** Map loop progress onto the run: exposures get equal dwell, waiting runs collapse into short beats. */
export function replayTimeAt(progress: number): ReplayFrame {
  const v = Math.max(0, Math.min(totalWeight - 1e-9, Math.max(0, Math.min(0.999999, progress)) * totalWeight))
  let lo = 0, hi = segments.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (segCum[mid]! <= v) lo = mid; else hi = mid - 1
  }
  const seg = segments[lo]!
  const span = Math.max(1e-6, segCum[lo + 1]! - segCum[lo]!)
  const frac = Math.max(0, Math.min(1, (v - segCum[lo]!) / span))
  const nowSec = seg.fromSec + frac * (seg.toSec - seg.fromSec)
  // The readout skips to the quiet stretch before the next exposure; the sky travels the whole way.
  // Whole turns of the sky are trimmed off first, so a gap of several nights still crosses once.
  let skySec = nowSec
  if (seg.kind === 'gap') {
    // Eased, so the sky pulls away and settles rather than snapping into and out of the sweep.
    const e = frac * frac * (3 - 2 * frac)
    skySec = seg.sweepFromSec + e * (seg.toSec - seg.sweepFromSec)
  }
  return {
    actionIndex: seg.actionIndex,
    slotIndex: slotIndexAt(nowSec),
    nowSec,
    skySec,
    frac,
    gap: seg.kind === 'gap' ? { nights: seg.nights, slots: seg.slots } : null,
  }
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

setReplayData(demoReplay as unknown as RawReplay, 'demo')

export function useReplayClock() {
  onMounted(acquire)
  onUnmounted(release)
  return { state: readonly(state), setPaused, seek: seekReplay, replayProgress, replayTimeAt }
}
