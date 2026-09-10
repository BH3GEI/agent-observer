<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'
import { loadScenarios, type Scenario } from '../../lib/data'
import { downloadObject } from '../../lib/storage'
import { useAdmin } from '../../composables/useAdmin'
import DashShell from '../../components/layout/DashShell.vue'

const { t, busy, run, flash } = useAdmin()
const rows = ref<Scenario[]>([])

async function load() { rows.value = await loadScenarios() }

async function save(s: Scenario) {
  const wallclock = Math.max(60, Math.round(Number(s.global_wallclock_seconds) || 0))
  const ok = await run(async () => {
    const { error } = await supabase.from('scenarios').update({
      weather_public: s.weather_public, forecasts_public: s.forecasts_public, events_public: s.events_public, tiles_public: s.tiles_public,
      is_active: s.is_active, global_wallclock_seconds: wallclock, name: s.name, description: s.description,
    }).eq('id', s.id)
    if (error) throw error
  }, t('admin.scenarios.saved'))
  if (ok) await load()
}
async function download(s: Scenario, file: string) {
  try { await downloadObject('scenarios', `${s.slug}/${file}`, `${s.slug}-${file.split('/').pop()}`) } catch { flash.error(t('subs.download_failed')) }
}
const cli = `# scenarios are directories (config/*.json + outputs/reference/*.csv); create and register them with the worker CLI
python -m worker.main gen-scenario --slug eval-c --seed 4242 --days 30 --start-date 2026-12-01 --wallclock 3600 --hidden-weather --hidden-forecasts
python -m worker.main add-scenario --slug my-scenario --root /path/to/scenario_dir --wallclock 7200 [--hidden-weather] [--hidden-forecasts] [--public-events]`
onMounted(load)
</script>

<template>
  <DashShell admin :kicker="t('admin.kicker')" :title="t('admin.nav.scenarios')">
    <div class="table-wrap mt-2">
      <table class="data-table" data-testid="admin-scenarios">
        <thead><tr><th>{{ t('admin.scenarios.slug') }}</th><th>{{ t('admin.scenarios.name') }}</th><th class="r">{{ t('admin.scenarios.nights') }}</th><th class="r">{{ t('admin.scenarios.slots') }}</th><th class="r">{{ t('admin.scenarios.tiles') }}</th><th class="r">{{ t('admin.scenarios.targets') }}</th><th class="r">{{ t('admin.scenarios.requests') }}</th><th>{{ t('admin.scenarios.wallclock') }}</th><th>{{ t('admin.scenarios.seed') }}</th><th>{{ t('admin.scenarios.contract') }}</th><th>{{ t('admin.scenarios.flags') }}</th><th>{{ t('admin.scenarios.files') }}</th></tr></thead>
        <tbody>
          <tr v-for="s in rows" :key="s.id">
            <td class="m">{{ s.slug }}</td>
            <td style="min-width: 15rem"><input v-model="s.name" type="text" class="input mb-1"><input v-model="s.description" type="text" class="input text-xs" :placeholder="t('admin.scenarios.description')"></td>
            <td class="r m">{{ s.n_nights ?? '—' }}</td><td class="r m">{{ s.n_slots ?? '—' }}</td><td class="r m">{{ s.n_tiles ?? '—' }}</td><td class="r m">{{ s.n_targets ?? '—' }}</td><td class="r m">{{ s.n_requests ?? '—' }}</td>
            <td class="whitespace-nowrap" style="min-width: 8rem"><input v-model.number="s.global_wallclock_seconds" type="number" min="60" step="60" class="input m" style="width: 6rem" :data-testid="`wallclock-${s.slug}`"> s</td>
            <td class="m">{{ s.seed ?? '—' }}<div class="text3 xs">{{ (s.checksum ?? '').slice(0, 10) }}</div></td>
            <td class="m xs">{{ s.contract ?? '—' }}</td>
            <td class="whitespace-nowrap">
              <div class="flex flex-col gap-1">
                <label class="check m-0"><input v-model="s.weather_public" type="checkbox"> {{ t('admin.scenarios.weather_public') }}</label>
                <label class="check m-0"><input v-model="s.forecasts_public" type="checkbox"> {{ t('admin.scenarios.forecasts_public') }}</label>
                <label class="check m-0"><input v-model="s.events_public" type="checkbox"> {{ t('admin.scenarios.events_public') }}</label>
                <label class="check m-0"><input v-model="s.tiles_public" type="checkbox"> {{ t('admin.scenarios.tiles_public') }}</label>
                <label class="check m-0"><input v-model="s.is_active" type="checkbox"> {{ t('admin.scenarios.active') }}</label>
                <button type="button" class="copy-btn self-start" :disabled="busy" :data-testid="`save-${s.slug}`" @click="save(s)">{{ t('common.save') }}</button>
              </div>
            </td>
            <td class="xs" style="min-width: 9rem">
              <button type="button" class="accent-l" @click="download(s, 'outputs/reference/scenario_manifest.json')">manifest</button> ·
              <button type="button" class="accent-l" @click="download(s, 'outputs/reference/tiles.csv')">tiles</button> ·
              <button type="button" class="accent-l" @click="download(s, 'outputs/reference/weather.csv')">weather</button> ·
              <button type="button" class="accent-l" @click="download(s, 'outputs/reference/weather_events.csv')">events</button> ·
              <button type="button" class="accent-l" @click="download(s, 'config/score_config.json')">score cfg</button>
            </td>
          </tr>
          <tr v-if="!rows.length"><td colspan="12" class="text3">{{ t('common.no_data') }}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="panel mt-10 max-w-4xl">
      <div class="hd"><h2>{{ t('admin.scenarios.cli_title') }}</h2></div>
      <p class="help mb-4">{{ t('admin.scenarios.cli_note') }}</p>
      <pre class="code-block" tabindex="0">{{ cli }}</pre>
    </div>
  </DashShell>
</template>
