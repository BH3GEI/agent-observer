import { computed, onMounted, onUnmounted, ref } from 'vue'
import { isSupabaseConfigured } from '../lib/supabase'
import { loadPhases, phaseStatus, type Phase } from '../lib/data'

/** Static fallback when the phases table is unreachable: the Online Competition start. */
export const FALLBACK_NEXT_START = '2026-10-04T16:00:00Z'

// One shared fetch for every clock on the page (header + hero); refreshed at most once a minute.
const shared = ref<Phase[]>([])
const loaded = ref(false)
let inflight: Promise<void> | null = null
let fetchedAt = 0
function fetchPhases(): Promise<void> {
  if (inflight) return inflight
  if (Date.now() - fetchedAt < 60_000 && loaded.value) return Promise.resolve()
  inflight = (async () => {
    // A slow or retrying backend must not hold the clocks in limbo: after 4 s the static
    // fallback is shown, and a late successful answer still replaces it.
    const attempt: Promise<Phase[]> = isSupabaseConfigured ? loadPhases().catch(() => []) : Promise.resolve([])
    const result = await Promise.race([attempt, new Promise<null>(resolve => window.setTimeout(() => resolve(null), 4000))])
    if (result) shared.value = result
    else void attempt.then(list => { shared.value = list; fetchedAt = Date.now() })
    loaded.value = true; fetchedAt = Date.now(); inflight = null
  })()
  return inflight
}

export interface CountdownParts { total: number; days: number; hours: number; minutes: number; seconds: number }
export function countdownParts(targetIso: string | null, now: number): CountdownParts {
  const total = Math.max(0, targetIso ? new Date(targetIso).getTime() - now : 0)
  const s = Math.floor(total / 1000)
  return { total, days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), minutes: Math.floor((s % 3600) / 60), seconds: s % 60 }
}

/**
 * Current open phase, the next upcoming phase and a per-second countdown to its start.
 * `next` is null when the table is unavailable or nothing is scheduled; use `nextStartsAt` (which
 * then carries the static fallback) together with `usingFallback` for the display.
 */
export function usePhaseClock() {
  const now = ref(Date.now())
  let timer: number | undefined
  onMounted(() => { void fetchPhases(); timer = window.setInterval(() => { now.value = Date.now() }, 1000) })
  onUnmounted(() => { if (timer) window.clearInterval(timer) })

  const phases = computed(() => shared.value.filter(p => p.is_active).map(p => ({ ...p, status: phaseStatus(p, now.value) })))
  const current = computed<Phase | null>(() => phases.value.filter(p => p.status === 'open').sort((a, b) => a.sort_order - b.sort_order)[0] ?? null)
  const next = computed<Phase | null>(() => phases.value
    .filter(p => p.status === 'upcoming' && p.starts_at)
    .sort((a, b) => new Date(a.starts_at!).getTime() - new Date(b.starts_at!).getTime())[0] ?? null)
  /** True when the phases table gave nothing (offline / unconfigured): the static date is shown instead. */
  const usingFallback = computed(() => loaded.value && shared.value.length === 0)
  const nextStartsAt = computed<string | null>(() => next.value?.starts_at ?? (usingFallback.value ? FALLBACK_NEXT_START : current.value?.ends_at ?? null))
  const countdown = computed(() => countdownParts(nextStartsAt.value, now.value))

  return { phases, loaded, current, next, nextStartsAt, usingFallback, countdown, now }
}
