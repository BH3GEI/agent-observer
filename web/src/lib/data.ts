import { readObjectText } from './storage'
import { parseTilesCsv } from './skymap'
import type { ScoreReport } from './report'
import type { RawReplay } from '../composables/useReplayClock'
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
  base_science: number; program_bonus: number; request_reward: number; coverage_bonus: number | null; coverage_evenness: number | null; penalty_total: number; completed_tiles: number | null; required_missing: number | null
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

export interface PublicSettings { registrationOpen: boolean; registrationDeadline: string | null; mechanicsPublic: boolean }

export async function loadPublicSettings(): Promise<PublicSettings> {
  const fallback: PublicSettings = { registrationOpen: true, registrationDeadline: null, mechanicsPublic: false }
  try {
    const { data, error } = await supabase.from('site_settings').select('key, value')
      .in('key', ['registration_open', 'registration_deadline', 'mechanics_public'])
    if (error || !data) return fallback
    const map = Object.fromEntries((data as { key: string; value: unknown }[]).map(row => [row.key, row.value]))
    const openFlag = !(map.registration_open === false || map.registration_open === 'false')
    const deadline = typeof map.registration_deadline === 'string' ? map.registration_deadline : null
    const beforeDeadline = !deadline || Date.now() < Date.parse(deadline)
    return {
      registrationOpen: openFlag && beforeDeadline,
      registrationDeadline: deadline,
      mechanicsPublic: !(map.mechanics_public === false || map.mechanics_public === 'false'),
    }
  } catch { return fallback }
}

export async function loadRegistrationOpen(): Promise<boolean> {
  return (await loadPublicSettings()).registrationOpen
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
    coverage_bonus: row.coverage_bonus == null ? null : Number(row.coverage_bonus),
    coverage_evenness: row.coverage_evenness == null ? null : Number(row.coverage_evenness),
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

// --- participants wall -------------------------------------------------------

export interface WallEntry {
  id: string; name: string; role: string | null; affiliation: string | null; city: string | null; blurb: string | null
  astro_level: number; ai_level: number; looking_for_team: boolean; team_name: string | null; joined_at: string
  github: string | null; seeking: string; seeking_count: number
}
export interface ParticipantsStats { total: number; on_wall: number; looking: number; teams: number }

export async function loadParticipantsWall(limit = 60): Promise<WallEntry[]> {
  const { data, error } = await supabase.rpc('participants_wall', { p_limit: limit })
  if (error) throw error
  return (data ?? []) as WallEntry[]
}

export async function loadParticipantsStats(): Promise<ParticipantsStats> {
  const { data, error } = await supabase.rpc('participants_stats')
  if (error) throw error
  return data as ParticipantsStats
}

export async function revealTeammateContact(id: string): Promise<{ contact: string; github: string } | null> {
  const { data, error } = await supabase.rpc('teammate_contact', { p_id: id })
  if (error) throw error
  return (data ?? null) as { contact: string; github: string } | null
}

export interface ChampionRun {
  team_id: string; team_name: string; submission_id: number; leader_github: string | null
  scenario_slug: string | null; report_path: string | null; score: number; scored_at: string | null
}
export async function loadChampionRun(): Promise<ChampionRun | null> {
  const { data, error } = await supabase.rpc('champion_run')
  if (error) throw error
  return (data as ChampionRun | null) ?? null
}

function csvRecords(text: string): Record<string, string>[] {
  const lines = text.replace(/^\ufeff/, '').trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const head = lines[0]!.split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    head.forEach((h, i) => { row[h] = cells[i] ?? '' })
    return row
  })
}
const measure = (value: string | undefined): number => {
  const v = (value ?? '').trim()
  return v ? Number(Number(v).toFixed(6)) : 0
}

/** The champion's real score report plus the scenario's public sky data, shaped for the console clock. */
export async function loadChampionReplay(meta: ChampionRun): Promise<RawReplay | null> {
  if (!meta.report_path || !meta.scenario_slug) return null
  const slug = meta.scenario_slug
  const [reportText, weatherText, tilesText, calendarText, scoreText] = await Promise.all([
    readObjectText('results', meta.report_path),
    readObjectText('scenarios', `${slug}/outputs/reference/weather.csv`),
    readObjectText('scenarios', `${slug}/outputs/reference/tiles.csv`),
    readObjectText('scenarios', `${slug}/config/calendar_config.json`),
    readObjectText('scenarios', `${slug}/config/score_config.json`),
  ])
  const report = JSON.parse(reportText) as ScoreReport
  const calendar = JSON.parse(calendarText) as { site: { latitude_deg: number; longitude_deg: number } }
  const scoreCfg = JSON.parse(scoreText) as { minimum_altitude_deg?: number }
  const tiles = parseTilesCsv(tilesText).map(t => ({ id: t.id, ra: t.ra, dec: t.dec, cls: t.cls, region: t.region, exp: t.exp ?? 900 }))
  const weather = csvRecords(weatherText).map(w => ({
    slot: w.slot_id ?? '', night: w.night_id ?? '', t: w.timestamp_utc ?? '',
    open: ['true', '1', 'yes'].includes((w.is_observable ?? '').trim().toLowerCase()),
    seeing: measure(w.seeing_arcsec), transp: measure(w.transparency), sky: measure(w.sky_quality), eff: measure(w.instrument_efficiency),
  }))
  const actions = report.actions.map(a => ({
    i: a.decision_id, slot: a.slot_id, a: a.action === 'wait' ? 'wait' : 'observe',
    tile: a.tile_id || '', program: a.program || '', outcome: String(a.outcome),
    t: a.start_utc, dt: Math.round(a.elapsed_seconds),
    score: Number((a.base_science_score + a.program_bonus_score).toFixed(4)), penalty: Number(a.penalty.toFixed(4)),
  }))
  if (!tiles.length || !weather.length || !actions.length) return null
  return {
    site: { lat: calendar.site.latitude_deg, lon: calendar.site.longitude_deg, min_alt: Number(scoreCfg.minimum_altitude_deg ?? 30) },
    tiles, weather, actions,
    score: { total: report.score.total, base_science: report.score.base_science },
    completed: report.completion.completed_tiles.length,
    required_missing: report.completion.required_missing,
    nights: new Set(weather.map(w => w.night)).size,
  }
}
