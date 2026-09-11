<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '../composables/useI18n'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errors'
import { loadPhases, type Phase, type Scenario } from '../lib/data'
import { sha256Hex, randomToken } from '../lib/storage'
import { zipSync } from 'fflate'
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
const agentHints = computed(() => t('submit.agent_hints') as string[])

const selectable = computed(() => phases.value.filter(p => isAdmin.value || p.status === 'open'))
const phase = computed(() => phases.value.find(p => p.slug === form.value.phase) ?? null)
/** Results files can only be scored against scenarios whose weather is public (the scorer needs the full weather truth). */
const resultScenarios = computed(() => (phase.value?.scenarios ?? []).filter(s => s.is_active && (s.weather_public || isAdmin.value)))
const agentScenarios = computed(() => (phase.value?.scenarios ?? []).filter(s => s.is_active))
const selectedScenario = computed<Scenario | null>(() => resultScenarios.value.find(s => s.slug === form.value.scenario) ?? null)
const accept = computed(() => form.value.kind === 'results' ? '.csv' : '.zip,.py')
const fmtClock = (s: number | null | undefined) => s == null ? '—' : s >= 3600 ? `${(s / 3600).toFixed(s % 3600 ? 1 : 0)} h` : `${Math.round(s / 60)} min`

watch(phase, p => {
  if (!p) return
  if (!p.allow_results && p.allow_agents) form.value.kind = 'agent'
  if (!p.allow_agents && p.allow_results) form.value.kind = 'results'
  if (!resultScenarios.value.some(s => s.slug === form.value.scenario)) form.value.scenario = resultScenarios.value[0]?.slug ?? ''
}, { immediate: true })
watch(() => form.value.kind, () => { file.value = null; if (fileInput.value) fileInput.value.value = '' })

const folderInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const packed = ref<{ files: number; names: string[] } | null>(null)
const SKIP_DIRS = new Set(['__pycache__', '.git', 'scratch', 'run_output', 'node_modules', '__MACOSX', '.venv', 'venv'])
const SKIP_FILES = /(\.pyc|\.pyo|\.DS_Store|\.zip)$/i

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  packed.value = null
  file.value = input.files?.[0] ?? null
}

/** A dropped/picked folder is zipped in the browser: the participant never has to build the package by hand. */
async function packFolder(list: File[]) {
  const entries: Record<string, [Uint8Array, { level: 9 }]> = {}
  const names: string[] = []
  let total = 0
  for (const f of list) {
    const rel = (f.webkitRelativePath || f.name).split('/').filter(Boolean)
    const parts = rel.length > 1 ? rel.slice(1) : rel   // strip the picked folder's own name
    if (parts.some(p => SKIP_DIRS.has(p)) || SKIP_FILES.test(f.name) || (f.name.startsWith('.env.') && f.name !== '.env.example')) continue
    total += f.size
    if (total > MAX_BYTES) { errors.value = [tf('submit.errors.too_large', { mb: 20 })]; return }
    entries[parts.join('/')] = [new Uint8Array(await f.arrayBuffer()), { level: 9 }]
    names.push(parts.join('/'))
  }
  if (!names.length) { errors.value = [t('submit.errors.folder_empty')]; return }
  const zip = zipSync(entries, { level: 9 })
  file.value = new File([zip], 'agent.zip', { type: 'application/zip' })
  packed.value = { files: names.length, names: names.slice(0, 12) }
  errors.value = []
}

function onFolder(event: Event) {
  const input = event.target as HTMLInputElement
  void packFolder(Array.from(input.files ?? []))
}

async function onDrop(event: DragEvent) {
  dragging.value = false
  event.preventDefault()
  const items = Array.from(event.dataTransfer?.items ?? [])
  const files: File[] = []
  const walk = async (entry: any, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const f: File = await new Promise((res, rej) => entry.file(res, rej))
      Object.defineProperty(f, 'webkitRelativePath', { value: prefix + f.name })
      files.push(f)
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej))
      for (const child of batch) await walk(child, prefix + entry.name + '/')
    }
  }
  let folder = false
  for (const item of items) {
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
    if (entry?.isDirectory) { folder = true; await walk(entry, '') }
    else if (entry?.isFile) { const f = item.getAsFile(); if (f) files.push(f) }
  }
  if (!files.length) return
  if (folder || files.length > 1) { await packFolder(files.map(f => f.webkitRelativePath ? f : Object.assign(f, {}))) }
  else { packed.value = null; file.value = files[0]! }
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
              <option v-for="s in resultScenarios" :key="s.id" :value="s.slug">{{ s.slug }} · {{ s.name }} · {{ s.n_nights }} {{ t('resources.nights') }}</option>
            </select>
            <div v-if="form.kind === 'results' && !resultScenarios.length" class="help">{{ t('submit.no_scenario') }}</div>
            <div v-else-if="form.kind === 'results'" class="help">{{ t('submit.results_public_only') }}</div>
          </label>
          <!-- scenario facts: global wall clock, visibility -->
          <div class="scenario-facts" data-testid="submit-wallclock">
            <template v-if="form.kind === 'results' && selectedScenario">
              <span class="pill">{{ selectedScenario.slug }}</span>
              <span class="pill">{{ selectedScenario.n_nights ?? '?' }} {{ t('resources.nights') }} · {{ selectedScenario.n_slots ?? '?' }} {{ t('resources.slots') }} · {{ selectedScenario.n_tiles ?? '?' }} {{ t('resources.tiles_n') }}</span>
              <span class="pill accent">{{ t('submit.wallclock') }} {{ fmtClock(selectedScenario.global_wallclock_seconds) }}</span>
              <span class="help w-full">{{ t('submit.wallclock_results_note') }}</span>
            </template>
            <template v-else-if="form.kind === 'agent' && agentScenarios.length">
              <div v-for="s in agentScenarios" :key="s.id" class="flex flex-wrap items-center gap-2">
                <span class="pill">{{ s.slug }}</span>
                <span class="pill">{{ s.n_nights ?? '?' }} {{ t('resources.nights') }} · {{ s.n_slots ?? '?' }} {{ t('resources.slots') }}</span>
                <span class="pill accent">{{ t('submit.wallclock') }} {{ fmtClock(s.global_wallclock_seconds) }}</span>
                <span class="pill" :class="s.weather_public ? 'ok' : 'closed'">{{ s.weather_public ? t('submit.weather_public') : t('submit.weather_hidden') }}</span>
              </div>
              <span class="help w-full">{{ t('submit.wallclock_note') }}</span>
            </template>
          </div>
          <div class="field mt-5">
            <span>{{ t('submit.file') }}</span>
            <div class="dropzone" :class="{ dragging }" data-testid="dropzone" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop="onDrop">
              <p class="dropzone-title">{{ form.kind === 'results' ? t('submit.drop_results') : t('submit.drop_agent') }}</p>
              <div class="flex flex-wrap items-center gap-3">
                <input ref="fileInput" data-testid="submit-file" type="file" :accept="accept" @change="onFile">
                <template v-if="form.kind === 'agent'">
                  <span class="text3 xs">{{ t('common.or') }}</span>
                  <button type="button" class="btn sm" data-testid="submit-folder-button" @click="folderInput?.click()">{{ t('submit.pick_folder') }}</button>
                  <input ref="folderInput" data-testid="submit-folder" type="file" webkitdirectory multiple class="hidden" @change="onFolder">
                </template>
              </div>
              <p v-if="packed" class="m xs mt-3 text-[#59d78d]" data-testid="packed-summary">{{ tf('submit.packed', { n: packed.files }) }} · {{ packed.names.join(', ') }}<span v-if="packed.files > packed.names.length"> …</span></p>
              <p v-else-if="file" class="m xs mt-3">{{ file.name }} · {{ (file.size / 1024).toFixed(1) }} KB</p>
            </div>
            <div class="help">{{ form.kind === 'results' ? t('submit.file_results') : t('submit.file_agent') }}</div>
            <ul v-if="form.kind === 'agent'" class="help list-disc pl-5" data-testid="agent-hints"><li v-for="h in agentHints" :key="h">{{ h }}</li></ul>
          </div>
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

<style scoped>
.dropzone { border: 1px dashed #4a4a4a; padding: 1rem 1.1rem; background: #0b0b0b; transition: border-color .15s, background .15s; }
.dropzone.dragging { border-color: #315efb; background: rgba(49,94,251,.08); }
.dropzone-title { margin: 0 0 .6rem; color: #bdbdbd; font-size: .9rem; }
.scenario-facts { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: -.5rem; }
.scenario-facts .help { margin-top: 0; }
</style>
