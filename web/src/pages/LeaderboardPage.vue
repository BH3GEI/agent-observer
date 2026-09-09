<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../composables/useI18n'
import { usePhases } from '../composables/usePhases'
import { loadLeaderboard, type LeaderboardEntry, type Phase } from '../lib/data'
import { useAuth } from '../stores/auth'
import { fmtUtc, num, pct } from '../lib/format'
import PageHead from '../components/layout/PageHead.vue'
import StatusPill from '../components/layout/StatusPill.vue'

const { t, tf, pick } = useI18n()
const route = useRoute()
const { team } = useAuth()
const { phases, loading: phasesLoading, reload } = usePhases(false)
const entries = ref<LeaderboardEntry[]>([])
const boardLoading = ref(false)
const updatedAt = ref<Date | null>(null)
let timer: number | undefined

const phase = computed<Phase | null>(() => {
  const slug = route.params.phase as string | undefined
  if (slug) return phases.value.find(p => p.slug === slug) ?? null
  return phases.value.find(p => p.counts_for_final && (p.status === 'open' || p.status === 'closed')) ?? phases.value.find(p => p.status === 'open') ?? phases.value[0] ?? null
})
const visible = computed(() => phase.value != null && phase.value.leaderboard_mode !== 'hidden')

async function loadBoard() {
  if (!phase.value || !visible.value) { entries.value = []; return }
  boardLoading.value = true
  try { entries.value = await loadLeaderboard(phase.value.slug, 500); updatedAt.value = new Date() }
  catch { entries.value = [] }
  finally { boardLoading.value = false }
}

watch(() => phase.value?.slug, () => { void loadBoard() })
onMounted(async () => {
  await reload()
  await loadBoard()
  timer = window.setInterval(() => { if (phase.value?.leaderboard_mode === 'live') void loadBoard() }, 30_000)
})
onUnmounted(() => { if (timer) window.clearInterval(timer) })
</script>

<template>
  <main class="poster-canvas">
    <PageHead :kicker="t('leaderboard.kicker')" :title="t('leaderboard.title')" :lede="t('leaderboard.intro')" />
    <section class="section tight"><div class="wrap">
      <div v-if="phases.length" class="tabs">
        <router-link v-for="p in phases" :key="p.id" :to="`/leaderboard/${p.slug}`" :class="{ active: phase && p.id === phase.id }">{{ pick(p.name_en, p.name_zh) }} · {{ t(`leaderboard.status.${p.status}`) }}</router-link>
      </div>

      <p v-if="phasesLoading" class="text3 mt-8 text-sm">{{ t('common.loading') }}</p>
      <p v-else-if="!phase" class="text2 mt-8">{{ t('leaderboard.no_phases') }}</p>

      <div v-else class="mt-12 grid gap-12 lg:grid-cols-[.72fr_1.28fr] lg:gap-20">
        <div>
          <p class="text2">{{ pick(phase.description_en, phase.description_zh) }}</p>
          <dl class="kv mt-8">
            <dt>{{ t('common.status') }}</dt>
            <dd class="flex flex-wrap gap-2"><StatusPill :status="phase.status" ns="leaderboard.status" /><span class="pill" :class="phase.leaderboard_mode">{{ phase.leaderboard_mode }}</span></dd>
            <dt>{{ t('common.utc') }}</dt><dd class="m text-sm">{{ fmtUtc(phase.starts_at) }} → {{ fmtUtc(phase.ends_at) }}</dd>
            <dt>{{ t('leaderboard.scenarios') }}</dt>
            <dd class="flex flex-wrap gap-2"><span v-for="s in phase.scenarios" :key="s.id" class="pill" :title="s.name">{{ s.slug }}<template v-if="!s.weather_public"> · {{ t('common.hidden') }}</template></span><span v-if="!phase.scenarios.length" class="text3">—</span></dd>
            <dt>{{ t('common.updated') }}</dt><dd class="m text-sm">{{ updatedAt ? fmtUtc(updatedAt.toISOString(), { seconds: true }) : '—' }} UTC</dd>
          </dl>
          <p class="text3 mt-8 text-sm">{{ t('leaderboard.tie') }} <template v-if="phase.scenarios.length > 1">{{ t('leaderboard.mean_note') }}</template></p>
          <p class="mt-6"><button type="button" class="btn sm" :disabled="boardLoading" @click="loadBoard">↻ {{ t('leaderboard.refresh') }}</button></p>
        </div>
        <div class="min-w-0">
          <p v-if="!visible" class="text2 py-12">{{ t('leaderboard.hidden') }}</p>
          <div v-else-if="!entries.length" class="py-16 text-center">
            <div class="empty-zero">00</div>
            <p class="text2 mt-3 text-sm">{{ boardLoading ? t('common.loading') : t('leaderboard.empty') }}</p>
          </div>
          <template v-else>
            <p v-if="phase.leaderboard_mode === 'frozen'" class="notice">{{ t('leaderboard.frozen') }}</p>
            <p v-else-if="phase.leaderboard_mode === 'published'" class="notice">{{ t('leaderboard.published') }}</p>
            <p class="label mb-4">{{ tf('leaderboard.n_entries', { n: entries.length }) }}</p>
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>{{ t('leaderboard.rank') }}</th><th>{{ t('leaderboard.team') }}</th><th class="r">{{ t('leaderboard.score') }}</th><th class="r">{{ t('leaderboard.science') }}</th><th class="r">{{ t('leaderboard.completion') }}</th><th class="r">{{ t('leaderboard.uniformity') }}</th><th class="r">{{ t('leaderboard.submissions') }}</th><th>{{ t('leaderboard.kind') }}</th></tr></thead>
                <tbody>
                  <tr v-for="row in entries" :key="row.team_id" data-testid="lb-row" :class="{ me: team && team.id === row.team_id }">
                    <td class="m text-[#315efb]">{{ row.rank }}</td>
                    <td>{{ row.team_name }}<span v-if="team && team.id === row.team_id" class="label accent ml-2">{{ t('leaderboard.me') }}</span></td>
                    <td class="r m">{{ num(row.total_score) }}</td>
                    <td class="r m">{{ num(row.science_score) }}</td>
                    <td class="r m">{{ pct(row.completion_rate) }}</td>
                    <td class="r m">{{ num(row.uniformity_score, 3) }}</td>
                    <td class="r m">{{ row.submission_count }}</td>
                    <td class="xs">{{ row.kind ? t(`kind.${row.kind}`) : '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </template>
        </div>
      </div>
    </div></section>
  </main>
</template>
