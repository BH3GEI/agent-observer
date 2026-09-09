<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { isSupabaseConfigured, supabase } from '../../lib/supabase'
import { loadLeaderboard, loadPhases, mainPhase, type LeaderboardEntry, type Phase } from '../../lib/data'
import { useAuth } from '../../stores/auth'
import { fmtUtc, num, pct } from '../../lib/format'
import ScoreBars from '../leaderboard/ScoreBars.vue'
import SkeletonRows from '../layout/SkeletonRows.vue'

const { t, pick } = useI18n()
const { team } = useAuth()
const phase = ref<Phase | null>(null)
const entries = ref<LeaderboardEntry[]>([])
const hidden = ref(false)
const loading = ref(true)
const refreshing = ref(false)
const error = ref(false)
const teamCount = ref<number | null>(null)
const updatedAt = ref<Date | null>(null)
let timer: number | undefined

const top = computed(() => entries.value.slice(0, 10))
const scoredRuns = computed(() => entries.value.reduce((sum, row) => sum + row.submission_count, 0))
const boardLink = computed(() => phase.value ? `/leaderboard/${phase.value.slug}` : '/leaderboard')

async function load() {
  if (!isSupabaseConfigured) { loading.value = false; error.value = true; return }
  refreshing.value = true
  try {
    const phases = await loadPhases()
    phase.value = mainPhase(phases)
    hidden.value = phase.value?.leaderboard_mode === 'hidden'
    entries.value = phase.value && !hidden.value ? await loadLeaderboard(phase.value.slug, 500) : []
    updatedAt.value = new Date()
    error.value = false
    loading.value = false
    const { count, error: countError } = await supabase.from('teams').select('id', { count: 'exact', head: true })
    teamCount.value = countError ? null : count
  } catch { error.value = true }
  finally { loading.value = false; refreshing.value = false }
}

onMounted(() => { load(); timer = window.setInterval(load, 60_000) })
onUnmounted(() => { if (timer) window.clearInterval(timer) })
</script>

<template>
  <section id="leaderboard" class="poster-section poster-canvas py-24 md:py-40">
    <div class="relative z-10 mx-auto max-w-[1600px] px-5 md:px-10 xl:px-14">
      <div class="grid gap-14 lg:grid-cols-[.72fr_1.28fr] lg:gap-20">
        <div class="reveal">
          <span class="poster-kicker mt-14">{{ t('home.leaderboard.kicker') }}</span>
          <h2 class="section-title distressed-type mt-9">{{ t('home.leaderboard.title') }}</h2>
          <p class="mt-8 max-w-lg text-base leading-relaxed text-text-secondary md:text-lg">{{ t('home.leaderboard.lede') }}</p>

          <div class="mt-12 flex items-center gap-4 font-mono text-xs uppercase tracking-[.1em] text-[#315efb]">
            <span class="signal-dot"></span>
            {{ entries.length ? t('home.leaderboard.signal_live') : t('home.leaderboard.signal_waiting') }}
          </div>
          <div class="stats stats-2 mt-10">
            <div class="stat"><b>{{ teamCount ?? entries.length }}</b><span>{{ t('home.stats_labels.teams') }}</span></div>
            <div class="stat"><b>{{ scoredRuns }}</b><span>{{ t('home.stats_labels.submissions') }}</span></div>
          </div>
        </div>

        <div class="reveal reveal-delay-1 border-y poster-rule min-w-0">
          <div class="flex flex-wrap items-center justify-between gap-4 border-b poster-rule py-5">
            <span class="font-mono text-xs uppercase tracking-[.1em] text-text-muted">
              <template v-if="phase">{{ pick(phase.name_en, phase.name_zh) }} · {{ t(`leaderboard.status.${phase.status}`) }}</template>
              <template v-if="updatedAt"> · {{ t('leaderboard.updated') }} {{ fmtUtc(updatedAt.toISOString()) }} UTC</template>
              <template v-else-if="!phase">{{ t('home.leaderboard.feed') }}</template>
            </span>
            <div class="flex gap-5">
              <button type="button" class="font-mono text-xs uppercase tracking-[.1em] text-text-tertiary hover:text-[#315efb] disabled:opacity-50" :disabled="refreshing" @click="load">↻ {{ t('leaderboard.refresh') }}</button>
              <router-link :to="boardLink" class="font-mono text-xs uppercase tracking-[.1em] text-[#315efb]">{{ t('leaderboard.full') }} ↗</router-link>
            </div>
          </div>

          <div v-if="loading" class="py-6"><SkeletonRows :rows="6" :cols="5" :label="t('leaderboard.loading')" /></div>
          <div v-else-if="!entries.length" class="grid min-h-80 place-items-center py-16 text-center">
            <div>
              <div class="empty-zero">00</div>
              <p class="mt-4 max-w-sm text-sm leading-relaxed text-text-secondary">
                {{ hidden ? t('leaderboard.hidden') : error ? t('leaderboard.unavailable') : t('leaderboard.empty') }}
              </p>
            </div>
          </div>

          <template v-else>
            <div class="py-6"><ScoreBars :entries="entries" :team-id="team?.id ?? null" :updated-at="updatedAt" /></div>
            <div class="table-wrap">
              <table class="data-table min-w-[720px]">
                <thead><tr><th>#</th><th>{{ t('leaderboard.team') }}</th><th class="r">{{ t('leaderboard.score') }}</th><th class="r">{{ t('leaderboard.science') }}</th><th class="r">{{ t('leaderboard.completion') }}</th><th class="r">{{ t('leaderboard.uniformity') }}</th><th class="r">{{ t('leaderboard.submissions') }}</th></tr></thead>
                <tbody>
                  <tr v-for="row in top" :key="row.team_id" data-testid="lb-row" :class="{ me: team && team.id === row.team_id }">
                    <td class="m text-[#315efb]">{{ row.rank }}</td>
                    <td class="font-medium text-text-primary">{{ row.team_name }}</td>
                    <td class="r m">{{ num(row.total_score) }}</td>
                    <td class="r m">{{ num(row.science_score) }}</td>
                    <td class="r m">{{ pct(row.completion_rate) }}</td>
                    <td class="r m">{{ num(row.uniformity_score, 3) }}</td>
                    <td class="r m">{{ row.submission_count }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.signal-dot { width: .55rem; height: .55rem; background: #315efb; box-shadow: 1rem 0 0 rgba(255,255,255,.8); }
</style>
