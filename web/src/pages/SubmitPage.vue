<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '../composables/useI18n'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errors'
import { loadPhases, type Phase } from '../lib/data'
import { sha256Hex, randomToken } from '../lib/storage'
import { fmtUtc } from '../lib/format'
import { useAuth } from '../stores/auth'
import { useFlash } from '../stores/flash'
import DashShell from '../components/layout/DashShell.vue'

const MAX_BYTES = 20 * 1024 * 1024
const { t, tf, pick } = useI18n()
const i18n = useI18n()
const route = useRoute()
const router = useRouter()
const flash = useFlash()
const { team, isAdmin, refreshMe } = useAuth()

const phases = ref<Phase[]>([])
const quota = ref<Record<string, number>>({})
const loading = ref(true)
const busy = ref(false)
const step = ref('')
const errors = ref<string[]>([])
const form = ref({ phase: '', kind: 'results' as 'results' | 'agent', scenario: '', title: '', notes: '' })
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
type Item = { title: string; desc: string }
const help = computed(() => t('home.submission.items') as Item[])

const selectable = computed(() => phases.value.filter(p => isAdmin.value || p.status === 'open'))
const phase = computed(() => phases.value.find(p => p.slug === form.value.phase) ?? null)
const scenarios = computed(() => (phase.value?.scenarios ?? []).filter(s => s.is_active && (s.weather_public || isAdmin.value)))
const accept = computed(() => form.value.kind === 'results' ? '.csv' : '.py,.zip')

watch(phase, p => {
  if (!p) return
  if (!p.allow_results && p.allow_agents) form.value.kind = 'agent'
  if (!p.allow_agents && p.allow_results) form.value.kind = 'results'
  if (!scenarios.value.some(s => s.slug === form.value.scenario)) form.value.scenario = scenarios.value[0]?.slug ?? ''
}, { immediate: true })
watch(() => form.value.kind, () => { file.value = null; if (fileInput.value) fileInput.value.value = '' })

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
}

function phaseLabel(p: Phase) {
  const left = Math.max(0, p.daily_limit - (quota.value[p.slug] ?? 0))
  return `${pick(p.name_en, p.name_zh)} · ${t(`leaderboard.status.${p.status}`)} · ${tf('submit.quota_left', { n: left })}`
}

async function submit() {
  errors.value = []
  const f = file.value
  if (!team.value) errors.value.push(t('submit.errors.need_team'))
  if (!phase.value) errors.value.push(t('submit.errors.bad_phase'))
  if (!f) errors.value.push(t('submit.errors.file_required'))
  const ext = f ? f.name.toLowerCase().slice(f.name.lastIndexOf('.')) : ''
  if (f && form.value.kind === 'results' && ext !== '.csv') errors.value.push(t('submit.errors.results_csv'))
  if (f && form.value.kind === 'agent' && !['.py', '.zip'].includes(ext)) errors.value.push(t('submit.errors.agent_file'))
  if (f && f.size > MAX_BYTES) errors.value.push(tf('submit.errors.too_large', { mb: 20 }))
  if (form.value.kind === 'results' && !form.value.scenario) errors.value.push(t('submit.errors.bad_scenario'))
  if (errors.value.length || !f || !team.value || !phase.value) return

  busy.value = true
  try {
    step.value = t('submit.hashing')
    const sha = await sha256Hex(f)
    step.value = t('submit.uploading')
    const path = `${team.value.id}/${Date.now()}-${randomToken(6)}${ext}`
    const { error: uploadError } = await supabase.storage.from('submissions').upload(path, f, { upsert: false, contentType: ext === '.csv' ? 'text/csv' : ext === '.zip' ? 'application/zip' : 'text/x-python' })
    if (uploadError) throw uploadError
    step.value = t('common.working')
    const { data, error } = await supabase.rpc('create_submission', {
      p_phase_slug: phase.value.slug,
      p_kind: form.value.kind,
      p_scenario_slug: form.value.kind === 'results' ? form.value.scenario : null,
      p_storage_path: path,
      p_filename: f.name,
      p_sha256: sha,
      p_title: form.value.title.trim(),
      p_notes: form.value.notes.trim(),
    })
    if (error) throw error
    flash.success(t('flash.submission_queued'))
    router.push(`/submissions/${data}`)
  } catch (e) {
    const message = describeError(e, i18n, ['submit.errors'])
    errors.value = [message === t('submit.errors.daily_limit') && phase.value ? tf('submit.errors.daily_limit', { n: phase.value.daily_limit }) : message]
    flash.error(errors.value[0]!)
  } finally { busy.value = false; step.value = '' }
}

onMounted(async () => {
  await refreshMe()
  try {
    phases.value = await loadPhases()
    const preferred = typeof route.query.phase === 'string' ? route.query.phase : ''
    form.value.phase = selectable.value.find(p => p.slug === preferred)?.slug ?? selectable.value.find(p => p.status === 'open')?.slug ?? selectable.value[0]?.slug ?? ''
    if (team.value) {
      const counts = await Promise.all(selectable.value.map(p => supabase.rpc('team_daily_count', { p_phase_slug: p.slug }).then(r => [p.slug, Number(r.data ?? 0)] as const)))
      quota.value = Object.fromEntries(counts)
    }
  } finally { loading.value = false }
})
</script>

<template>
  <DashShell :kicker="t('dash.title')" :title="t('submit.title')">
    <p v-if="loading" class="text3 text-sm">{{ t('common.loading') }}</p>
    <div v-else-if="!team" class="panel">
      <p class="text2">{{ t('submit.errors.need_team') }}</p>
      <p class="mt-5"><router-link class="btn primary sm" to="/team">{{ t('nav.team') }} →</router-link></p>
    </div>
    <div v-else class="dash-grid">
      <div class="panel">
        <div v-if="errors.length" class="errors" role="alert"><ul class="list-disc pl-5"><li v-for="e in errors" :key="e">{{ e }}</li></ul></div>
        <p v-if="!selectable.length" class="text2">{{ t('submit.no_phase') }}</p>
        <form v-else @submit.prevent="submit" novalidate>
          <label class="field"><span>{{ t('submit.phase') }}</span>
            <select data-testid="submit-phase" v-model="form.phase">
              <option v-for="p in selectable" :key="p.id" :value="p.slug">{{ phaseLabel(p) }}</option>
            </select>
            <div v-if="phase && phase.status !== 'open'" class="help">{{ phase.status === 'upcoming' ? tf('submit.phase_upcoming', { date: fmtUtc(phase.starts_at) }) : t('submit.phase_closed') }}</div>
          </label>
          <div class="field"><span>{{ t('submit.kind') }}</span>
            <label class="check"><input data-testid="submit-kind-results" v-model="form.kind" type="radio" value="results" :disabled="phase ? !phase.allow_results : false"> <span><b>{{ t('kind.results') }}</b><br><small class="text3">{{ t('submit.help_results') }}</small></span></label>
            <label class="check"><input data-testid="submit-kind-agent" v-model="form.kind" type="radio" value="agent" :disabled="phase ? !phase.allow_agents : false"> <span><b>{{ t('kind.agent') }}</b><br><small class="text3">{{ t('submit.help_agent') }}</small></span></label>
          </div>
          <label class="field"><span>{{ t('submit.scenario') }}</span>
            <select data-testid="submit-scenario" v-model="form.scenario" :disabled="form.kind !== 'results'">
              <option v-if="form.kind !== 'results'" value="">{{ t('submit.all_scenarios') }}</option>
              <option v-for="s in scenarios" :key="s.id" :value="s.slug">{{ s.slug }} · {{ s.name }}</option>
            </select>
            <div v-if="form.kind === 'results' && !scenarios.length" class="help">{{ t('submit.no_scenario') }}</div>
          </label>
          <label class="field"><span>{{ t('submit.file') }}</span>
            <input ref="fileInput" data-testid="submit-file" type="file" :accept="accept" @change="onFile">
            <div class="help">{{ form.kind === 'results' ? t('submit.file_results') : t('submit.file_agent') }}</div>
          </label>
          <label class="field"><span>{{ t('submit.title_field') }}</span><input data-testid="submit-title" v-model="form.title" type="text" maxlength="160"></label>
          <label class="field"><span>{{ t('submit.notes') }}</span><textarea v-model="form.notes" maxlength="2000"></textarea></label>
          <button data-testid="submit-button" class="btn primary" type="submit" :disabled="busy">{{ busy ? step || t('common.working') : t('submit.button') }} →</button>
        </form>
      </div>
      <div>
        <div class="panel">
          <div class="hd"><h2>{{ t('home.submission.title') }}</h2></div>
          <p v-for="item in help" :key="item.title" class="mb-4 text-sm"><b class="text-text-primary">{{ item.title }}</b><br><span class="text2">{{ item.desc }}</span></p>
          <p class="mt-4"><router-link class="label accent" to="/docs">{{ t('home.submission.link') }} →</router-link></p>
        </div>
      </div>
    </div>
  </DashShell>
</template>
