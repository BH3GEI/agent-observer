<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import type { LeaderboardEntry } from '../../lib/data'
import { fmtUtc, num } from '../../lib/format'

const props = defineProps<{ entries: LeaderboardEntry[]; teamId: string | null; updatedAt: Date | null }>()
const { t, tf } = useI18n()
const top = computed(() => props.entries.slice(0, 10))
const mine = computed(() => props.teamId ? props.entries.find(e => e.team_id === props.teamId) ?? null : null)
const outside = computed(() => mine.value && !top.value.some(e => e.team_id === mine.value!.team_id) ? mine.value : null)
const max = computed(() => Math.max(1, ...props.entries.slice(0, 10).map(e => Math.max(e.total_score, e.science_score)), ...(outside.value ? [outside.value.science_score] : [])))
const scoredRuns = computed(() => props.entries.reduce((s, e) => s + e.submission_count, 0))
const widthPct = (v: number) => `${Math.max(0, Math.min(100, (v / max.value) * 100)).toFixed(2)}%`
const penaltyOf = (e: LeaderboardEntry) => Math.max(0, e.science_score - e.total_score)
const isMe = (e: LeaderboardEntry) => props.teamId != null && e.team_id === props.teamId
</script>

<template>
  <div class="score-bars" data-testid="score-bars">
    <div class="score-bars-head">
      <span class="label">{{ t('leaderboard.chart.title') }}</span>
      <span class="score-bars-legend" aria-hidden="true"><i class="score"></i>{{ t('leaderboard.score') }} <i class="penalty"></i>{{ t('leaderboard.chart.penalty') }}</span>
    </div>
    <ol class="score-bars-list">
      <li v-for="row in top" :key="row.team_id" class="score-bar-row" :class="{ me: isMe(row) }" data-testid="score-bar">
        <span class="rank">{{ row.rank }}</span>
        <span class="name"><span class="truncate">{{ row.team_name }}</span><span v-if="isMe(row)" class="tag">{{ t('leaderboard.chart.your_team') }}</span></span>
        <span class="track" :title="tf('leaderboard.chart.tooltip', { score: num(row.total_score), science: num(row.science_score), penalty: num(penaltyOf(row)) })">
          <i class="score" :style="{ width: widthPct(row.total_score) }"></i>
          <i class="penalty" :style="{ left: widthPct(row.total_score), width: widthPct(penaltyOf(row)) }"></i>
        </span>
        <span class="value">{{ num(row.total_score) }}</span>
      </li>
    </ol>
    <div v-if="outside" class="score-bars-outside">
      <span class="label">{{ t('leaderboard.chart.your_position') }}</span>
      <ol class="score-bars-list">
        <li class="score-bar-row me" data-testid="score-bar-me">
          <span class="rank">{{ outside.rank }}</span>
          <span class="name"><span class="truncate">{{ outside.team_name }}</span><span class="tag">{{ t('leaderboard.chart.your_team') }}</span></span>
          <span class="track"><i class="score" :style="{ width: widthPct(outside.total_score) }"></i><i class="penalty" :style="{ left: widthPct(outside.total_score), width: widthPct(penaltyOf(outside)) }"></i></span>
          <span class="value">{{ num(outside.total_score) }}</span>
        </li>
      </ol>
    </div>
    <dl class="score-bars-stats">
      <div><dt>{{ t('leaderboard.chart.teams_on_board') }}</dt><dd>{{ entries.length }}</dd></div>
      <div><dt>{{ t('leaderboard.chart.scored_runs') }}</dt><dd>{{ scoredRuns }}</dd></div>
      <div><dt>{{ t('leaderboard.chart.last_update') }}</dt><dd>{{ updatedAt ? `${fmtUtc(updatedAt.toISOString(), { seconds: true })} UTC` : '—' }}</dd></div>
    </dl>
  </div>
</template>

<style scoped>
.score-bars { border: 1px solid rgba(255,255,255,.2); background: rgba(6,6,7,.6); font-variant-numeric: tabular-nums; }
.score-bars-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .5rem 1rem; padding: .85rem 1rem; border-bottom: 1px solid rgba(255,255,255,.12); }
.score-bars-legend { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .66rem; letter-spacing: .1em; text-transform: uppercase; color: #858585; }
.score-bars-legend i { display: inline-block; width: .8rem; height: .5rem; margin: 0 .35rem 0 .6rem; vertical-align: middle; }
.score-bars-list { list-style: none; margin: 0; padding: .5rem 1rem; }
.score-bar-row {
  display: grid; grid-template-columns: 2rem minmax(6rem, 11rem) minmax(0, 1fr) 5.5rem; align-items: center; gap: .75rem;
  padding: .45rem .25rem; border-bottom: 1px solid rgba(255,255,255,.06); border-left: 2px solid transparent;
}
.score-bar-row:last-child { border-bottom: 0; }
.score-bar-row.me { border-left-color: #315efb; background: rgba(49,94,251,.1); }
.rank { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .75rem; color: #315efb; }
.name { display: flex; align-items: center; gap: .5rem; min-width: 0; font-size: .875rem; color: #f5f5f5; }
.name .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag { flex-shrink: 0; border: 1px solid #315efb; padding: .05rem .35rem; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .56rem; letter-spacing: .1em; text-transform: uppercase; color: #78a6ff; }
.track { position: relative; height: 10px; background: rgba(255,255,255,.06); overflow: hidden; }
.track i { position: absolute; top: 0; bottom: 0; }
i.score { left: 0; background: #315efb; }
i.penalty { background: repeating-linear-gradient(135deg, rgba(49,94,251,.55) 0 2px, rgba(49,94,251,.12) 2px 5px); }
.score-bars-legend i.penalty { background: repeating-linear-gradient(135deg, rgba(49,94,251,.7) 0 2px, rgba(49,94,251,.15) 2px 5px); }
.value { text-align: right; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .8rem; color: #f5f5f5; }
.score-bars-outside { border-top: 1px dashed rgba(255,255,255,.2); padding-top: .6rem; }
.score-bars-outside > .label { display: block; padding: 0 1rem; }
.score-bars-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 0; border-top: 1px solid rgba(255,255,255,.12); }
.score-bars-stats > div { min-width: 0; padding: .7rem 1rem; border-right: 1px solid rgba(255,255,255,.08); }
.score-bars-stats > div:last-child { border-right: 0; }
.score-bars-stats dt { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .6rem; letter-spacing: .12em; text-transform: uppercase; color: #858585; }
.score-bars-stats dd { margin: .2rem 0 0; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .8rem; color: #f5f5f5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 640px) {
  .score-bar-row { grid-template-columns: 1.5rem minmax(0, 1fr) 4.5rem; grid-template-areas: 'rank name value' 'rank track track'; row-gap: .3rem; }
  .rank { grid-area: rank; } .name { grid-area: name; } .track { grid-area: track; } .value { grid-area: value; }
  .score-bars-stats { grid-template-columns: 1fr; }
  .score-bars-stats > div { border-right: 0; border-bottom: 1px solid rgba(255,255,255,.08); }
  .score-bars-stats > div:last-child { border-bottom: 0; }
}
</style>
