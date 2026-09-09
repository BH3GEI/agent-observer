<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from '../composables/useI18n'
import { appUrl, publicSiteUrl } from '../composables/api'
import { isSupabaseConfigured } from '../lib/supabase'
import { loadScenarios, type Scenario } from '../lib/data'
import { downloadObject } from '../lib/storage'
import { useFlash } from '../stores/flash'
import PageHead from '../components/layout/PageHead.vue'

const { t } = useI18n()
const flash = useFlash()
const scenarios = ref<Scenario[]>([])
const loading = ref(true)
const busy = ref<string | null>(null)

const kit = [
  { n: '01', title: 'resources.kit', desc: 'resources.kit_desc', href: appUrl('/downloads/agent-observer-starter-kit.zip'), primary: true, label: 'common.download' },
  { n: '02', title: 'resources.scorer', desc: 'resources.scorer_desc', href: appUrl('/downloads/scorer.py'), primary: false, label: 'common.download' },
  { n: '03', title: 'resources.protocol', desc: 'resources.protocol_desc', href: appUrl('/downloads/protocol.py'), primary: false, label: 'common.download' },
  { n: '04', title: 'resources.skill', desc: 'resources.skill_desc', href: appUrl('/skill.md'), primary: false, label: 'common.view', view: true },
]
const cli = `unzip agent-observer-starter-kit.zip && cd agent-observer-starter-kit
python3 local_runner.py --agent agent.py --weather example/weather.csv --tiles example/tiles.csv --config score_config.json --out run_output
python3 generate_example_data.py --seed 7 --n-nights 5 --slots-per-night 20 --n-tiles 150 --output-dir scenario7
python3 sac_submit.py --base ${publicSiteUrl()} --phase practice --kind agent --file agent.py`

async function download(scenario: Scenario, file: string) {
  const key = `${scenario.slug}/${file}`
  busy.value = key
  try { await downloadObject('scenarios', key, `${scenario.slug}-${file}`) }
  catch { flash.error(t('subs.download_failed')) }
  finally { busy.value = null }
}

onMounted(async () => {
  try { scenarios.value = isSupabaseConfigured ? (await loadScenarios()).filter(s => s.is_active) : [] }
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
          <p class="mt-5"><a class="btn sm" :class="{ primary: item.primary }" :href="item.href" :download="item.view ? undefined : ''" :target="item.view ? '_blank' : undefined">{{ t(item.label) }} {{ item.view ? '→' : '↓' }}</a></p>
        </article>
      </div>

      <h2 class="label accent mt-20 mb-4">{{ t('resources.scenarios') }}</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>slug</th><th>{{ t('common.name') }}</th><th class="r">{{ t('resources.nights') }}</th><th class="r">{{ t('resources.slots') }}</th><th class="r">{{ t('resources.tiles_n') }}</th><th>{{ t('resources.weather') }}</th><th>{{ t('resources.tiles') }}</th><th>{{ t('resources.config') }}</th></tr></thead>
          <tbody>
            <tr v-for="s in scenarios" :key="s.id">
              <td class="m">{{ s.slug }}</td>
              <td>{{ s.name }}<div class="text3 text-xs">{{ s.description }}</div></td>
              <td class="r m">{{ s.n_nights ?? '—' }}</td><td class="r m">{{ s.n_slots ?? '—' }}</td><td class="r m">{{ s.n_tiles ?? '—' }}</td>
              <td><button v-if="s.weather_public" type="button" class="accent-l" :disabled="busy === `${s.slug}/weather.csv`" @click="download(s, 'weather.csv')">weather.csv ↓</button><span v-else class="pill">{{ t('resources.hidden') }}</span></td>
              <td><button v-if="s.tiles_public" type="button" class="accent-l" :disabled="busy === `${s.slug}/tiles.csv`" @click="download(s, 'tiles.csv')">tiles.csv ↓</button><span v-else class="pill">{{ t('resources.hidden') }}</span></td>
              <td><button type="button" class="accent-l" :disabled="busy === `${s.slug}/score_config.json`" @click="download(s, 'score_config.json')">score_config.json ↓</button></td>
            </tr>
            <tr v-if="!loading && !scenarios.length"><td colspan="8" class="text3">{{ t('common.no_data') }}</td></tr>
            <tr v-if="loading"><td colspan="8" class="text3">{{ t('common.loading') }}</td></tr>
          </tbody>
        </table>
      </div>

      <h2 class="label accent mt-20 mb-4">{{ t('resources.cli') }}</h2>
      <pre class="code-block">{{ cli }}</pre>
    </div></section>
  </main>
</template>
