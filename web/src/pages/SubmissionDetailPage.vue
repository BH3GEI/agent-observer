<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../composables/useI18n'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errors'
import { SUBMISSION_SELECT, PENDING_STATUSES } from '../lib/data'
import { downloadObject, readObjectText } from '../lib/storage'
import { fmtUtc, num, pct } from '../lib/format'
import { useAuth } from '../stores/auth'
import { useFlash } from '../stores/flash'
import { useSubmissionWatch } from '../composables/useSubmissionWatch'
import DashShell from '../components/layout/DashShell.vue'
import StatusPill from '../components/layout/StatusPill.vue'
import ObservedSkyMap from '../components/submissions/ObservedSkyMap.vue'
import SkeletonRows from '../components/layout/SkeletonRows.vue'

interface ReportAction { decision_id: number; slot_id: string | number; action: string; tile_id: string | number | null; program: string | null; valid: boolean; message: string; start_timestamp_utc?: string | null; elapsed_seconds: number; unproductive_seconds: number; science_score: number }
interface Report { actions: ReportAction[]; region_completion?: Record<string, number> }

const { t, tf, pick } = useI18n()
const i18n = useI18n()
const route = useRoute()
const flash = useFlash()
const { team, refreshMe } = useAuth()
const sub = ref<any | null>(null)
const reports = ref<Record<string, Report | null>>({})
const loading = ref(true)
const busy = ref(false)
const missing = ref(false)
const id = computed(() => String(route.params.id))
const pending = computed(() => Boolean(sub.value && PENDING_STATUSES.has(sub.value.status)))
const evaluations = computed(() => ((sub.value?.evaluations ?? []) as any[]).slice().sort((a, b) => Number(a.id) - Number(b.id)))
const watcher = useSubmissionWatch(load, () => pending.value)

async function load() {
  const { data, error } = await supabase.from('submissions').select(`${SUBMISSION_SELECT}, profiles(name)`).eq('id', id.value).maybeSingle()
  if (error || !data) { missing.value = true; return }
  sub.value = data
  for (const ev of evaluations.value) {
    if (ev.status === 'scored' && ev.report_path && !(ev.id in reports.value)) {
      try { reports.value[ev.id] = JSON.parse(await readObjectText('results', ev.report_path)) as Report }
      catch { reports.value[ev.id] = null }
    }
  }
}

function barClass(a: ReportAction) {
  if (!a.valid) return 'bad'
  if (a.action === 'wait') return 'wait'
  return a.unproductive_seconds > 0 ? 'unp' : 'obs'
}
function regionEntries(report: Report) {
  return Object.entries(report.region_completion ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]))
}
const summaryOf = (ev: any) => (ev.summary ?? {}) as Record<string, any>

async function cancel() {
  busy.value = true
  try {
    const { error } = await supabase.rpc('cancel_submission', { p_id: Number(id.value) })
    if (error) throw error
    flash.success(t('flash.submission_cancelled'))
    await load()
  } catch (e) { flash.error(describeError(e, i18n, ['submit.errors'])) }
  finally { busy.value = false }
}
async function download(path: string, name: string) {
  try { await downloadObject('results', path, `sub-${id.value}-${name}`) }
  catch { flash.error(t('subs.download_failed')) }
}

onMounted(async () => {
  await refreshMe()
  try { await load() } finally { loading.value = false }
  if (team.value) watcher.start(team.value.id)
})
</script>

<template>
  <DashShell :kicker="t('subs.title')" :title="tf('subs.detail_title', { id })">
    <template #title-extra><span v-if="sub?.title" class="text3"> · {{ sub.title }}</span></template>
    <SkeletonRows v-if="loading" :rows="6" :cols="3" :label="t('common.loading')" />
    <div v-else-if="missing || !sub" class="panel"><p class="text2">{{ t('common.not_found') }}</p><p class="mt-5"><router-link class="btn sm" to="/submissions">{{ t('subs.back') }}</router-link></p></div>
    <div v-else class="dash-grid">
      <div>
        <div class="panel">
          <div class="hd">
            <h2 class="flex flex-wrap items-center gap-2"><StatusPill :status="sub.status" testid="sub-status" live /> {{ sub.phases ? pick(sub.phases.name_en, sub.phases.name_zh) : '' }} · {{ t(`kind.${sub.kind}`) }}</h2>
            <span class="m xs">{{ fmtUtc(sub.created_at) }} UTC</span>
          </div>
          <p v-if="pending" class="text2 flex items-center gap-3"><span class="live-dot"></span>{{ t('subs.waiting') }}</p>
          <div v-if="sub.error" class="errors mt-4"><b>{{ t('subs.error') }}:</b> {{ sub.error }}</div>
          <div v-if="sub.score != null" class="mt-4 flex flex-wrap items-end gap-10">
            <div><div class="label">{{ t('subs.score') }}</div><div class="score-big text-[#315efb]" data-testid="sub-score">{{ num(sub.score) }}</div></div>
            <dl class="kv">
              <dt>{{ t('subs.science') }}</dt><dd class="m">{{ num(sub.science_score) }}</dd>
              <dt>{{ t('subs.completion') }}</dt><dd class="m">{{ pct(sub.completion) }}</dd>
              <dt>{{ t('subs.uniformity') }}</dt><dd class="m">{{ num(sub.uniformity, 3) }}</dd>
            </dl>
          </div>
          <span v-else data-testid="sub-score" class="hidden">—</span>
          <dl class="kv mt-6">
            <dt>{{ t('subs.file') }}</dt><dd class="m text-sm">{{ sub.original_filename }}</dd>
            <dt>{{ t('subs.sha') }}</dt><dd class="m xs break-all">{{ sub.sha256 }}</dd>
            <dt>{{ t('subs.by') }}</dt><dd>{{ sub.profiles?.name ?? '—' }}</dd>
            <template v-if="sub.notes"><dt>{{ t('submit.notes') }}</dt><dd class="whitespace-pre-line">{{ sub.notes }}</dd></template>
          </dl>
          <div v-if="sub.status === 'queued'" class="mt-5"><button type="button" class="btn sm danger" :disabled="busy" @click="cancel">{{ t('subs.cancel') }}</button></div>
        </div>

        <div v-for="ev in evaluations" :key="ev.id" class="panel mt-8">
          <div class="hd">
            <h2 class="flex flex-wrap items-center gap-2"><StatusPill :status="ev.status" /> {{ t('subs.scenario') }}: <span class="m">{{ ev.scenarios?.slug }}</span> · {{ ev.scenarios?.name }}</h2>
            <span v-if="ev.runtime_seconds" class="m xs">{{ t('subs.runtime') }} {{ num(ev.runtime_seconds, 1) }}s</span>
          </div>
          <div v-if="ev.error" class="errors">{{ ev.error }}</div>
          <template v-if="ev.status === 'scored'">
            <div class="flex flex-wrap gap-8">
              <div><div class="label">{{ t('subs.score') }}</div><div class="m text-2xl">{{ num(ev.score) }}</div></div>
              <div><div class="label">{{ t('subs.science') }}</div><div class="m text-2xl">{{ num(ev.science_score) }}</div></div>
              <div><div class="label">{{ t('subs.penalty') }}</div><div class="m text-2xl">−{{ num(summaryOf(ev).waste_penalty ?? 0) }}</div></div>
              <div><div class="label">{{ t('subs.tiles_done') }}</div><div class="m text-2xl">{{ summaryOf(ev).completed_tiles ?? '—' }} / {{ summaryOf(ev).total_tiles ?? '—' }}</div></div>
              <div><div class="label">{{ t('subs.invalid_count') }}</div><div class="m text-2xl">{{ summaryOf(ev).invalid_actions ?? 0 }}</div></div>
            </div>
            <dl class="kv mt-5">
              <dt>{{ t('subs.waste') }}</dt>
              <dd class="m text-sm">{{ num(summaryOf(ev).total_waste_seconds ?? 0, 0) }}s · {{ t('subs.idle') }} {{ num(summaryOf(ev).waste_breakdown_seconds?.idle ?? 0, 0) }}s · {{ t('subs.invalid') }} {{ num(summaryOf(ev).waste_breakdown_seconds?.invalid_actions ?? 0, 0) }}s · {{ t('subs.unproductive') }} {{ num(summaryOf(ev).waste_breakdown_seconds?.unproductive_exposure ?? 0, 0) }}s</dd>
              <template v-if="summaryOf(ev).steps"><dt>{{ t('subs.steps') }}</dt><dd class="m text-sm">{{ summaryOf(ev).steps }} · {{ num(summaryOf(ev).agent_wall_seconds ?? 0, 1) }}s</dd></template>
            </dl>
            <template v-if="reports[ev.id]">
              <ObservedSkyMap v-if="ev.scenarios?.slug" class="mt-8" :slug="ev.scenarios.slug" :actions="reports[ev.id]!.actions" :tiles-public="Boolean(ev.scenarios?.tiles_public)" />
              <h3 class="label mt-8">{{ t('subs.actions_title') }}</h3>
              <div class="timeline mt-3">
                <i v-for="a in reports[ev.id]!.actions" :key="a.decision_id" :class="barClass(a)" :style="{ flex: String(a.elapsed_seconds || 1) }" :title="`#${a.decision_id} ${a.action} ${a.tile_id ?? ''} ${a.message} ${num(a.science_score, 1)}`"></i>
              </div>
              <div class="legend"><span><i style="background:#315efb"></i>observe</span><span><i style="background:#333"></i>wait</span><span><i style="background:#5a4a1f"></i>{{ t('subs.unproductive') }}</span><span><i style="background:#7a2a2a"></i>{{ t('subs.invalid') }}</span></div>
              <h3 class="label mt-8">{{ t('subs.region_title') }}</h3>
              <div class="regions mt-3">
                <div v-for="[region, value] in regionEntries(reports[ev.id]!)" :key="region">R{{ region }}<div class="bar"><i :style="{ width: `${Math.round(Number(value) * 1000) / 10}%` }"></i></div>{{ Math.round(Number(value) * 100) }}%</div>
              </div>
              <details class="plain mt-8">
                <summary class="label">{{ t('subs.show_all') }} ({{ reports[ev.id]!.actions.length }})</summary>
                <div class="table-wrap mt-3">
                  <table class="data-table small">
                    <thead><tr><th>#</th><th>slot</th><th>action</th><th>tile</th><th>program</th><th>msg</th><th class="r">s</th><th class="r">score</th></tr></thead>
                    <tbody>
                      <tr v-for="a in reports[ev.id]!.actions" :key="a.decision_id">
                        <td class="m">{{ a.decision_id }}</td><td class="m">{{ a.slot_id }}</td><td>{{ a.action }}</td><td class="m">{{ a.tile_id ?? '' }}</td><td class="m">{{ a.program ?? '' }}</td>
                        <td :class="a.valid ? 'accent-l' : 'text3'">{{ a.message }}</td><td class="r m">{{ a.elapsed_seconds }}</td><td class="r m">{{ num(a.science_score, 1) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </details>
            </template>
            <p v-else-if="ev.report_path && reports[ev.id] === null" class="text3 mt-4 text-sm">{{ t('subs.no_report') }}</p>
          </template>
          <p v-if="summaryOf(ev).warnings?.length" class="mt-4 text-sm"><b>{{ t('subs.warnings') }}:</b> {{ summaryOf(ev).warnings.join('; ') }}</p>
          <details v-if="summaryOf(ev).stderr_tail" class="plain mt-4"><summary class="text-sm">{{ t('subs.stderr') }}</summary><pre class="code-block mt-3">{{ summaryOf(ev).stderr_tail }}</pre></details>
          <p class="actions-inline mt-5">
            <button v-if="ev.report_path" type="button" class="btn sm" @click="download(ev.report_path, `${ev.scenarios?.slug}-report.json`)">{{ t('subs.report') }} ↓</button>
            <button v-if="ev.decisions_path" type="button" class="btn sm" @click="download(ev.decisions_path, `${ev.scenarios?.slug}-decisions.csv`)">{{ t('subs.decisions') }} ↓</button>
            <button v-if="ev.log_path" type="button" class="btn sm" @click="download(ev.log_path, `${ev.scenarios?.slug}-agent.log`)">{{ t('subs.log') }} ↓</button>
          </p>
        </div>
      </div>
      <div>
        <div class="panel">
          <div class="hd"><h2>{{ t('leaderboard.title') }}</h2></div>
          <p class="text2 text-sm">{{ t('leaderboard.tie') }}</p>
          <p class="mt-5 actions-inline">
            <router-link class="btn sm" :to="sub.phases ? `/leaderboard/${sub.phases.slug}` : '/leaderboard'">{{ t('leaderboard.full') }} →</router-link>
            <router-link class="btn sm" to="/submissions">{{ t('subs.back') }}</router-link>
          </p>
        </div>
      </div>
    </div>
  </DashShell>
</template>
