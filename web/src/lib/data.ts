import { supabase } from './supabase'

export type PhaseStatus = 'open' | 'upcoming' | 'closed' | 'disabled'
export type LeaderboardMode = 'live' | 'frozen' | 'hidden' | 'published'

export interface Scenario {
  id: string; slug: string; name: string; description: string | null
  weather_public: boolean; tiles_public: boolean; is_active: boolean
  n_slots: number | null; n_nights: number | null; n_tiles: number | null; seed: number | null; checksum: string | null; created_at: string
}
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
  completion_rate: number; uniformity_score: number; submission_count: number; best_submission_id: number | null; kind: string | null; scored_at: string | null
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
    .select('*, phase_scenarios(scenario_id, scenarios(*))')
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
  const { data, error } = await supabase.from('scenarios').select('*').order('slug')
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
    submission_count: Number(row.submission_count ?? 0),
    best_submission_id: row.best_submission_id == null ? null : Number(row.best_submission_id),
    kind: row.kind ?? null,
    scored_at: row.scored_at ?? null,
  }))
}

export const SUBMISSION_SELECT = '*, phases(slug,name_en,name_zh), scenarios(slug,name), evaluations(*, scenarios(slug,name,tiles_public))'
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
