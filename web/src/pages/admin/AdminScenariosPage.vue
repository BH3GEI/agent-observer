<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'
import { loadScenarios, type Scenario } from '../../lib/data'
import { downloadObject, sha256Hex } from '../../lib/storage'
import { appUrl } from '../../composables/api'
import { useAdmin } from '../../composables/useAdmin'
import DashShell from '../../components/layout/DashShell.vue'

const { t, busy, run, flash } = useAdmin()
const rows = ref<Scenario[]>([])
const form = ref({ slug: '', name: '', description: '', seed: '' as string | number, weather_public: false, tiles_public: true })
const files = ref<{ weather: File | null; tiles: File | null; config: File | null }>({ weather: null, tiles: null, config: null })

async function load() { rows.value = await loadScenarios() }
function pickFile(key: 'weather' | 'tiles' | 'config', event: Event) {
  files.value[key] = (event.target as HTMLInputElement).files?.[0] ?? null
}
function csvRows(text: string): string[][] {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => line.split(','))
}
function countNights(table: string[][]): number | null {
  const header = table[0]?.map(h => h.trim().toLowerCase()) ?? []
  const idx = header.findIndex(h => h === 'night' || h === 'night_id' || h === 'night_index')
  if (idx < 0) return null
  return new Set(table.slice(1).map(r => r[idx])).size
}

async function saveFlags(s: Scenario) {
  const ok = await run(async () => {
    const { error } = await supabase.from('scenarios').update({ weather_public: s.weather_public, tiles_public: s.tiles_public, is_active: s.is_active }).eq('id', s.id)
    if (error) throw error
  }, t('admin.scenarios.saved'))
  if (ok) await load()
}

async function upload() {
  const weather = files.value.weather, tiles = files.value.tiles
  if (!form.value.slug.trim() || !weather || !tiles) { flash.error(t('submit.errors.file_required')); return }
  const ok = await run(async () => {
    const slug = form.value.slug.trim()
    const [weatherText, tilesText] = await Promise.all([weather.text(), tiles.text()])
    const weatherTable = csvRows(weatherText), tilesTable = csvRows(tilesText)
    let config: Blob | null = files.value.config
    if (!config) {
      const res = await fetch(appUrl('/downloads/score_config.json'))
      config = res.ok ? await res.blob() : null
    }
    const { error } = await supabase.from('scenarios').insert({
      slug, name: form.value.name.trim() || slug, description: form.value.description.trim(),
      weather_public: form.value.weather_public, tiles_public: form.value.tiles_public, is_active: true,
      n_slots: Math.max(0, weatherTable.length - 1), n_nights: countNights(weatherTable), n_tiles: Math.max(0, tilesTable.length - 1),
      seed: form.value.seed === '' ? null : Number(form.value.seed), checksum: await sha256Hex(new Blob([weatherText, tilesText])),
    })
    if (error) throw error
    const bucket = supabase.storage.from('scenarios')
    const put = async (name: string, body: Blob, type: string) => { const r = await bucket.upload(`${slug}/${name}`, body, { upsert: true, contentType: type }); if (r.error) throw r.error }
    await put('weather.csv', weather, 'text/csv')
    await put('tiles.csv', tiles, 'text/csv')
    if (config) await put('score_config.json', config, 'application/json')
  }, t('admin.scenarios.uploaded'))
  if (ok) { form.value = { slug: '', name: '', description: '', seed: '', weather_public: false, tiles_public: true }; files.value = { weather: null, tiles: null, config: null }; await load() }
}
async function download(s: Scenario, file: string) {
  try { await downloadObject('scenarios', `${s.slug}/${file}`, `${s.slug}-${file}`) } catch { flash.error(t('subs.download_failed')) }
}
onMounted(load)
</script>

<template>
  <DashShell admin :kicker="t('admin.kicker')" :title="t('admin.nav.scenarios')">
    <div class="table-wrap mt-2">
      <table class="data-table">
        <thead><tr><th>{{ t('admin.scenarios.slug') }}</th><th>{{ t('admin.scenarios.name') }}</th><th class="r">{{ t('admin.scenarios.nights') }}</th><th class="r">{{ t('admin.scenarios.slots') }}</th><th class="r">{{ t('admin.scenarios.tiles') }}</th><th>{{ t('admin.scenarios.seed') }}</th><th>{{ t('admin.scenarios.checksum') }}</th><th>{{ t('admin.scenarios.flags') }}</th><th>{{ t('admin.scenarios.files') }}</th></tr></thead>
        <tbody>
          <tr v-for="s in rows" :key="s.id">
            <td class="m">{{ s.slug }}</td>
            <td>{{ s.name }}<div class="text3 text-xs">{{ s.description }}</div></td>
            <td class="r m">{{ s.n_nights ?? '—' }}</td><td class="r m">{{ s.n_slots ?? '—' }}</td><td class="r m">{{ s.n_tiles ?? '—' }}</td>
            <td class="m">{{ s.seed ?? '—' }}</td><td class="m xs">{{ (s.checksum ?? '').slice(0, 12) }}</td>
            <td>
              <div class="actions-inline">
                <label class="check m-0"><input v-model="s.weather_public" type="checkbox"> {{ t('admin.scenarios.weather_public') }}</label>
                <label class="check m-0"><input v-model="s.tiles_public" type="checkbox"> {{ t('admin.scenarios.tiles_public') }}</label>
                <label class="check m-0"><input v-model="s.is_active" type="checkbox"> {{ t('admin.scenarios.active') }}</label>
                <button type="button" class="copy-btn" :disabled="busy" @click="saveFlags(s)">{{ t('common.save') }}</button>
              </div>
            </td>
            <td class="xs whitespace-nowrap"><button type="button" class="accent-l" @click="download(s, 'weather.csv')">w</button> · <button type="button" class="accent-l" @click="download(s, 'tiles.csv')">t</button> · <button type="button" class="accent-l" @click="download(s, 'score_config.json')">c</button></td>
          </tr>
          <tr v-if="!rows.length"><td colspan="9" class="text3">{{ t('common.no_data') }}</td></tr>
        </tbody>
      </table>
    </div>

    <form class="panel mt-10 max-w-3xl" @submit.prevent="upload">
      <div class="hd"><h2>{{ t('admin.scenarios.upload') }}</h2></div>
      <p class="help mb-4">{{ t('admin.scenarios.note') }}</p>
      <div class="grid-form">
        <label class="field"><span>{{ t('admin.scenarios.slug') }}</span><input v-model="form.slug" type="text" required pattern="[a-z0-9-]+"></label>
        <label class="field"><span>{{ t('admin.scenarios.name') }}</span><input v-model="form.name" type="text"></label>
        <label class="field"><span>{{ t('admin.scenarios.seed') }}</span><input v-model="form.seed" type="number"></label>
        <label class="field"><span>{{ t('admin.scenarios.description') }}</span><input v-model="form.description" type="text"></label>
        <label class="field"><span>{{ t('admin.scenarios.weather_file') }}</span><input type="file" accept=".csv" required @change="pickFile('weather', $event)"></label>
        <label class="field"><span>{{ t('admin.scenarios.tiles_file') }}</span><input type="file" accept=".csv" required @change="pickFile('tiles', $event)"></label>
        <label class="field full"><span>{{ t('admin.scenarios.config_file') }}</span><input type="file" accept=".json" @change="pickFile('config', $event)"></label>
      </div>
      <label class="check"><input v-model="form.weather_public" type="checkbox"> {{ t('admin.scenarios.weather_public') }}</label>
      <label class="check"><input v-model="form.tiles_public" type="checkbox"> {{ t('admin.scenarios.tiles_public') }}</label>
      <button class="btn primary sm" type="submit" :disabled="busy">{{ busy ? t('common.uploading') : t('common.upload') }}</button>
    </form>
  </DashShell>
</template>
