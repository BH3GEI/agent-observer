import { supabase } from './supabase'

export type PhaseStatus = 'open' | 'upcoming' | 'closed' | 'disabled'
export type LeaderboardMode = 'live' | 'frozen' | 'hidden' | 'published'

export interface Scenario {
  id: string; slug: string; name: string; description: string | null
  weather_public: boolean; tiles_public: boolean; forecasts_public: boolean; events_public: boolean; is_active: boolean
  n_slots: number | null; n_nights: number | null; n_tiles: number | null; n_targets: number | null; n_requests: number | null
  global_wallclock_seconds: number | null; contract: string | null; created_at: string
  /** Withheld from participants: `seed`, `checksum` and `manifest` would let anyone rebuild a hidden-weather
   *  scenario locally, so anon/authenticated have no column privilege on them. Only `admin_scenarios()` fills
   *  these in — everywhere else they are undefined. */
  seed?: number | null; checksum?: string | null; manifest?: Record<string, unknown> | null
}

/** The scenario columns participants are allowed to read (see migration 20260915000100_hide_scenario_seeds). */
export const SCENARIO_PUBLIC_COLUMNS =
  'id, slug, name, description, weather_public, forecasts_public, events_public, tiles_public, is_active, ' +
  'n_slots, n_nights, n_tiles, n_targets, n_requests, global_wallclock_seconds, contract, created_at'

/** Files of a scenario directory in the `scenarios` bucket (`<slug>/config/<file>` and `<slug>/outputs/reference/<file>`). */
export type ScenarioFileGroup = 'config' | 'data' | 'weather' | 'forecasts' | 'events'
export interface ScenarioFile { key: string; name: string; group: ScenarioFileGroup; flag?: 'weather_public' | 'forecasts_public' | 'events_public' }
export const SCENARIO_FILES: ScenarioFile[] = [
  ...['scenario_config.json', 'calendar_config.json', 'tile_config.json', 'weather_config.json', 'request_config.json', 'workflow_config.json', 'score_config.json']
    .map(name => ({ key: `config/${name}`, name, group: 'config' as const })),
  ...['night_calendar.csv', 'slots.csv', 'tiles.csv', 'targets.csv', 'tile_windows.csv', 'observation_requests.csv', 'observation_request_tiles.csv',
    'scenario_manifest.json', 'calendar_metadata.json', 'catalog_metadata.json', 'observation_request_metadata.json']
    .map(name => ({ key: `outputs/reference/${name}`, name, group: 'data' as const })),
  { key: 'outputs/reference/weather.csv', name: 'weather.csv', group: 'weather', flag: 'weather_public' },
  { key: 'outputs/reference/weather_metadata.json', name: 'weather_metadata.json', group: 'weather', flag: 'weather_public' },
  { key: 'outputs/reference/weather_forecasts.csv', name: 'weather_forecasts.csv', group: 'forecasts', flag: 'forecasts_public' },
  { key: 'outputs/reference/weather_events.csv', name: 'weather_events.csv', group: 'events', flag: 'events_public' },
]
export const scenarioFileVisible = (s: Scenario, f: ScenarioFile) => !f.flag || Boolean(s[f.flag])
export const scenarioObjectKey = (slug: string, file: string) => `${slug}/${file}`
export interface Phase {
  id: string; slug: string; name_en: string; name_zh: string; description_en: string | null; description_zh: string | null
  sort_order: number; starts_at: string | null; ends_at: string | null; allow_results: boolean; allow_agents: boolean
  daily_limit: number; leaderboard_mode: LeaderboardMode; counts_for_final: boolean; is_active: boolean
  scenarios: Scenario[]; status: PhaseStatus
}
export interface Announcement {
  id: string; title_en: string; title_zh: string; body_en: string | null; body_zh: string | null
  level: 'info' | 'warning' | 'success'; is_pinned: boolean; is_published: boolean; created_at: string
}
export interface LeaderboardEntry {
  rank: number; team_id: string; team_name: string; team_slug: string; total_score: number; science_score: number
  completion_rate: number; uniformity_score: number
  base_science: number; program_bonus: number; request_reward: number; penalty_total: number; completed_tiles: number | null; required_missing: number | null
  submission_count: number; best_submission_id: number | null; kind: string | null; scored_at: string | null
}

export interface PhaseCopy {
  /** Human-facing summary without operational numbers baked in. */
  description: string
  /** Operational facts rendered separately from the description. */
  facts: string[]
}

/**
 * Keep user-facing phase copy consistent with the database row.
 *
 * The description fields are prose only; submission limits, result/package support,
 * and leaderboard visibility are derived from structured columns so future changes
 * only need to happen in one place.
 */
export function phaseCopy(
  phase: Pick<Phase, 'description_en' | 'description_zh' | 'allow_results' | 'allow_agents' | 'daily_limit' | 'leaderboard_mode'>,
  locale: 'en' | 'zh',
): PhaseCopy {
  const description = (locale === 'zh' ? phase.description_zh : phase.description_en)
    ?? (locale === 'zh' ? phase.description_en : phase.description_zh)
    ?? ''
  const facts = locale === 'zh'
    ? [
        `结果文件 ${phase.allow_results ? '允许' : '不允许'}`,
        `智能体程序包 ${phase.allow_agents ? '允许' : '不允许'}`,
        `每队每天 ${phase.daily_limit} 次`,
        `榜单 ${phase.leaderboard_mode}`,
      ]
    : [
        `results files ${phase.allow_results ? 'allowed' : 'not allowed'}`,
        `agent packages ${phase.allow_agents ? 'allowed' : 'not allowed'}`,
        `${phase.daily_limit} submissions per team per day`,
        `leaderboard ${phase.leaderboard_mode}`,
      ]
  return { description, facts }
}

export function phaseStatus(p: { is_active: boolean; starts_at: string | null; ends_at: string | null }, now = Date.now()): PhaseStatus {
  if (!p.is_active) return 'disabled'
  if (p.starts_at && now < new Date(p.starts_at).getTime()) return 'upcoming'
  if (p.ends_at && now > new Date(p.ends_at).getTime()) return 'closed'
  return 'open'
}

export async function loadPhases(): Promise<Phase[]> {
  const { data, error } = await supabase
    .from('phases')
    .select(`*, phase_scenarios(scenario_id, scenarios(${SCENARIO_PUBLIC_COLUMNS}))`)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return ((data ?? []) as any[]).map(row => {
    const { phase_scenarios, ...rest } = row
    const scenarios = ((phase_scenarios ?? []) as any[]).map(link => link.scenarios).filter(Boolean) as Scenario[]
    scenarios.sort((a, b) => a.slug.localeCompare(b.slug))
    return { ...rest, scenarios, status: phaseStatus(rest) } as Phase
  })
}

/** The "main" phase: the counts_for_final one that is open/closed, else the first open one, else the first. */
export function mainPhase(phases: Phase[]): Phase | null {
  return phases.find(p => p.counts_for_final && (p.status === 'open' || p.status === 'closed'))
    ?? phases.find(p => p.status === 'open')
    ?? phases[0] ?? null
}

export async function loadScenarios(): Promise<Scenario[]> {
  const { data, error } = await supabase.from('scenarios').select(SCENARIO_PUBLIC_COLUMNS).order('slug')
  if (error) throw error
  return (data ?? []) as unknown as Scenario[]
}

/** Admin-only view of the same rows, including the withheld seed/checksum/manifest. */
export async function loadScenariosAsAdmin(): Promise<Scenario[]> {
  const { data, error } = await supabase.rpc('admin_scenarios')
  if (error) throw error
  return (data ?? []) as Scenario[]
}

export async function loadAnnouncements(limit?: number): Promise<Announcement[]> {
  let query = supabase.from('announcements').select('*').eq('is_published', true)
    .order('is_pinned', { ascending: false }).order('created_at', { ascending: false })
  if (limit) query = query.limit(limit)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Announcement[]
}

export async function loadRegistrationOpen(): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('site_settings').select('value').eq('key', 'registration_open').maybeSingle()
    if (error || !data) return true
    const value = (data as { value: unknown }).value
    return value === false || value === 'false' ? false : Boolean(value ?? true)
  } catch { return true }
}

export async function loadLeaderboard(phaseSlug: string | null, limit = 500): Promise<LeaderboardEntry[]> {
  const { data, error } = await supabase.rpc('leaderboard', { p_phase_slug: phaseSlug, p_limit: limit })
  if (error) throw error
  return ((data ?? []) as any[]).map((row, index) => ({
    rank: Number(row.rank ?? index + 1),
    team_id: String(row.team_id),
    team_name: String(row.team_name ?? '—'),
    team_slug: String(row.team_slug ?? ''),
    total_score: Number(row.total_score ?? 0),
    science_score: Number(row.science_score ?? 0),
    completion_rate: Number(row.completion_rate ?? 0),
    uniformity_score: Number(row.uniformity_score ?? 0),
    base_science: Number(row.base_science ?? 0),
    program_bonus: Number(row.program_bonus ?? 0),
    request_reward: Number(row.request_reward ?? 0),
    penalty_total: Number(row.penalty_total ?? 0),
    completed_tiles: row.completed_tiles == null ? null : Number(row.completed_tiles),
    required_missing: row.required_missing == null ? null : Number(row.required_missing),
    submission_count: Number(row.submission_count ?? 0),
    best_submission_id: row.best_submission_id == null ? null : Number(row.best_submission_id),
    kind: row.kind ?? null,
    scored_at: row.scored_at ?? null,
  }))
}

export const SUBMISSION_SELECT = '*, phases(slug,name_en,name_zh), scenarios(slug,name), evaluations(*, scenarios(slug,name,tiles_public,weather_public,global_wallclock_seconds,n_tiles,n_nights))'
export const PENDING_STATUSES = new Set(['queued', 'running'])

// --- sponsor API credits (redeem codes) -----------------------------------
export interface RedeemProvider { provider: string; available: number; claimed_by_my_team: boolean }
export interface RedeemCode { provider: string; code: string; note: string; assigned_at: string | null }
export interface CreditsNote { en: string; zh: string }

export async function loadRedeemProviders(): Promise<RedeemProvider[]> {
  const { data, error } = await supabase.rpc('redeem_providers')
  if (error) throw error
  return ((data ?? []) as any[]).map(row => ({ provider: String(row.provider), available: Number(row.available ?? 0), claimed_by_my_team: Boolean(row.claimed_by_my_team) }))
}

export async function loadMyRedeemCodes(): Promise<RedeemCode[]> {
  const { data, error } = await supabase.rpc('my_redeem_codes')
  if (error) throw error
  return ((data ?? []) as any[]).map(row => ({ provider: String(row.provider), code: String(row.code), note: String(row.note ?? ''), assigned_at: row.assigned_at ?? null }))
}

/** Optional explanatory text above the credits panel (site_settings.credits_note = {en, zh}); empty strings when unset. */
export async function loadCreditsNote(): Promise<CreditsNote> {
  try {
    const { data, error } = await supabase.from('site_settings').select('value').eq('key', 'credits_note').maybeSingle()
    if (error || !data) return { en: '', zh: '' }
    const value = ((data as { value: unknown }).value ?? {}) as Record<string, unknown>
    return { en: typeof value.en === 'string' ? value.en : '', zh: typeof value.zh === 'string' ? value.zh : '' }
  } catch { return { en: '', zh: '' } }
}
