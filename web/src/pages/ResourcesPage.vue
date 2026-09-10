<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '../composables/useI18n'
import { appUrl } from '../composables/api'
import { isSupabaseConfigured } from '../lib/supabase'
import { loadScenarios, SCENARIO_FILES, scenarioFileVisible, type Scenario, type ScenarioFile, type ScenarioFileGroup } from '../lib/data'
import { downloadObject } from '../lib/storage'
import { useFlash } from '../stores/flash'
import PageHead from '../components/layout/PageHead.vue'

const { t } = useI18n()
const flash = useFlash()
const scenarios = ref<Scenario[]>([])
const loading = ref(true)
const busy = ref<string | null>(null)
const GROUPS: ScenarioFileGroup[] = ['config', 'data', 'weather', 'forecasts', 'events']

const kit = [
  { n: '01', title: 'resources.kit', desc: 'resources.kit_desc', href: appUrl('/downloads/agent-observer-starter-kit.zip'), primary: true, label: 'common.download' },
  { n: '02', title: 'resources.scorer', desc: 'resources.scorer_desc', href: appUrl('/downloads/scoring_core.py'), primary: false, label: 'common.download' },
  { n: '03', title: 'resources.skill', desc: 'resources.skill_desc', href: appUrl('/skill.md'), primary: false, label: 'common.view', view: true },
  { n: '04', title: 'resources.docs', desc: 'resources.docs_desc', href: '/docs', primary: false, label: 'common.view', route: true },
]
const cli = `# environment for sac_submit.py (also printed in SKILL.md inside the kit)
export SAC_URL=${import.meta.env.VITE_SUPABASE_URL || 'https://<ref>.supabase.co'}
export SAC_KEY=${import.meta.env.VITE_SUPABASE_ANON_KEY || '<anon key>'}
export SAC_EMAIL=you@example.org SAC_PASSWORD='...'

unzip agent-observer-starter-kit.zip && cd agent-observer-starter-kit
# run the minimal agent locally against a downloaded scenario directory, then score the trace (exact commands: SKILL.md)
python3 -B run_challenge.py --root scenarios/dev-fortnight --agent-command python3 -B participant_agent/minimal_agent.py --output-dir run_output
python3 -B score_decisions.py --root scenarios/dev-fortnight run_output/decisions.csv --output run_output/score_report.json
# submit: a results file for a public-weather practice scenario, or the agent package (zip) for platform runs
python3 sac_submit.py --phase practice --kind results --scenario dev-fortnight --file run_output/decisions.csv --wait
python3 sac_submit.py --phase online --kind agent --file my_agent.zip --wait`

const filesFor = (group: ScenarioFileGroup) => SCENARIO_FILES.filter(f => f.group === group)
const groupVisible = (s: Scenario, group: ScenarioFileGroup) => filesFor(group).some(f => scenarioFileVisible(s, f))
const fmtClock = (v: number | null | undefined) => v == null ? '—' : v >= 3600 ? `${(v / 3600).toFixed(v % 3600 ? 1 : 0)} h` : `${Math.round(v / 60)} min`
const active = computed(() => scenarios.value.filter(s => s.is_active))

async function download(scenario: Scenario, file: ScenarioFile) {
  const key = `${scenario.slug}/${file.key}`
  busy.value = key
  try { await downloadObject('scenarios', key, `${scenario.slug}-${file.name}`) }
  catch { flash.error(t('subs.download_failed')) }
  finally { busy.value = null }
}

onMounted(async () => {
  try { scenarios.value = isSupabaseConfigured ? await loadScenarios() : [] }
  catch { scenarios.value = [] }
  finally { loading.value = false }
})
</script>

<template>
  <main class="poster-canvas">
    <PageHead :kicker="t('resources.kicker')" :title="t('resources.title')" :lede="t('resources.lede')" />
    <section class="section"><div class="wrap">
      <div class="cards cards-4">
        <article v-for="item in kit" :key="item.n" class="card">
          <span class="label accent">{{ item.n }}</span>
          <h3 class="mt-3">{{ t(item.title) }}</h3>
          <p>{{ t(item.desc) }}</p>
          <p class="mt-5">
            <router-link v-if="item.route" class="btn sm" :to="item.href">{{ t(item.label) }} →</router-link>
            <a v-else class="btn sm" :class="{ primary: item.primary }" :href="item.href" :download="item.view ? undefined : ''" :target="item.view ? '_blank' : undefined">{{ t(item.label) }} {{ item.view ? '→' : '↓' }}</a>
          </p>
        </article>
      </div>

      <h2 class="label accent mt-20 mb-2">{{ t('resources.scenarios') }}</h2>
      <p class="text2 mb-6 max-w-3xl text-sm">{{ t('resources.scenarios_note') }}</p>
      <p v-if="loading" class="text3 text-sm">{{ t('common.loading') }}</p>
      <p v-else-if="!active.length" class="text3 text-sm">{{ t('common.no_data') }}</p>
      <div v-else class="scenario-grid">
        <article v-for="s in active" :key="s.id" class="scenario-card" :data-testid="`resources-scenario-${s.slug}`">
          <header class="scenario-head">
            <div>
              <h3 class="m text-lg text-text-primary">{{ s.slug }}</h3>
              <p class="text2 mt-1 text-sm">{{ s.name }}</p>
              <p v-if="s.description" class="text3 mt-1 text-xs">{{ s.description }}</p>
            </div>
            <span class="pill" :class="s.weather_public ? 'ok' : 'closed'">{{ s.weather_public ? t('resources.weather_public') : t('resources.weather_hidden') }}</span>
          </header>
          <dl class="scenario-stats">
            <div><dt>{{ t('resources.wallclock') }}</dt><dd>{{ fmtClock(s.global_wallclock_seconds) }}</dd></div>
            <div><dt>{{ t('resources.nights') }}</dt><dd>{{ s.n_nights ?? '—' }}</dd></div>
            <div><dt>{{ t('resources.slots') }}</dt><dd>{{ s.n_slots ?? '—' }}</dd></div>
            <div><dt>{{ t('resources.tiles_n') }}</dt><dd>{{ s.n_tiles ?? '—' }}</dd></div>
            <div><dt>{{ t('resources.targets') }}</dt><dd>{{ s.n_targets ?? '—' }}</dd></div>
            <div><dt>{{ t('resources.requests') }}</dt><dd>{{ s.n_requests ?? '—' }}</dd></div>
          </dl>
          <div v-for="g in GROUPS" :key="g" class="file-group">
            <div class="file-group-head">
              <span class="label">{{ t(`resources.file_group.${g}`) }}</span>
              <span v-if="!groupVisible(s, g)" class="pill closed">{{ t('resources.hidden') }}</span>
            </div>
            <p class="text3 text-xs">{{ t(`resources.file_group_desc.${g}`) }}</p>
            <div class="file-list">
              <template v-for="f in filesFor(g)" :key="f.key">
                <button v-if="scenarioFileVisible(s, f)" type="button" class="file-btn" :disabled="busy === `${s.slug}/${f.key}`" :data-testid="`dl-${s.slug}-${f.name}`" @click="download(s, f)">{{ f.name }} ↓</button>
                <span v-else class="file-btn is-hidden" :title="t('resources.hidden')">{{ f.name }}</span>
              </template>
            </div>
          </div>
          <p class="text3 mt-3 text-xs m">{{ t('resources.contract') }}: {{ s.contract ?? 'challenge-score-v3' }} · {{ t('resources.seed') }} {{ s.seed ?? '—' }} · {{ (s.checksum ?? '').slice(0, 12) }}</p>
        </article>
      </div>

      <h2 class="label accent mt-20 mb-4">{{ t('resources.cli') }}</h2>
      <pre class="code-block" tabindex="0">{{ cli }}</pre>
    </div></section>
  </main>
</template>

<style scoped>
.scenario-grid { display: grid; gap: 1.5rem; }
@media (min-width: 1100px) { .scenario-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.scenario-card { border: 1px solid #3a3a3a; background: rgba(6,6,7,.7); padding: 1.5rem; min-width: 0; }
.scenario-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
.scenario-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin: 1.25rem 0 0; border: 1px solid #2a2a2a; background: #2a2a2a; }
@media (min-width: 640px) { .scenario-stats { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
.scenario-stats > div { background: #0b0b0b; padding: .6rem .7rem; min-width: 0; }
.scenario-stats dt { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .58rem; letter-spacing: .1em; text-transform: uppercase; color: #858585; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.scenario-stats dd { margin: .15rem 0 0; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .85rem; color: #f5f5f5; }
.file-group { margin-top: 1.25rem; }
.file-group-head { display: flex; align-items: center; gap: .75rem; margin-bottom: .2rem; }
.file-list { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .5rem; }
.file-btn { border: 1px solid #3a3a3a; padding: .25rem .55rem; font-family: 'IBM Plex Mono', ui-monospace, monospace; font-size: .7rem; color: #78a6ff; background: none; }
.file-btn:hover:not(:disabled):not(.is-hidden) { border-color: #78a6ff; color: #f5f5f5; }
.file-btn:disabled { opacity: .5; }
.file-btn.is-hidden { color: #6e6e6e; border-style: dashed; text-decoration: line-through; cursor: not-allowed; }
</style>
