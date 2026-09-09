<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from '../composables/useI18n'
import { appUrl } from '../composables/api'
import { supabase } from '../lib/supabase'
import { loadPhases, SUBMISSION_SELECT, PENDING_STATUSES, type Phase } from '../lib/data'
import { fmtUtc, num } from '../lib/format'
import { useAuth } from '../stores/auth'
import { useFlash } from '../stores/flash'
import { useSubmissionWatch } from '../composables/useSubmissionWatch'
import DashShell from '../components/layout/DashShell.vue'
import StatusPill from '../components/layout/StatusPill.vue'

const { t, tf, pick } = useI18n()
const route = useRoute()
const flash = useFlash()
const { me, team, refreshMe } = useAuth()
const phases = ref<Phase[]>([])
const quota = ref<Record<string, number>>({})
const submissions = ref<any[]>([])
const members = ref<any[]>([])
const loading = ref(true)
const watcher = useSubmissionWatch(loadSubmissions, () => submissions.value.some(s => PENDING_STATUSES.has(s.status)))

async function loadSubmissions() {
  if (!team.value) return
  const { data } = await supabase.from('submissions').select(SUBMISSION_SELECT).eq('team_id', team.value.id).order('created_at', { ascending: false }).limit(5)
  submissions.value = data ?? []
}

onMounted(async () => {
  if (route.query.denied) flash.error(t('errors.admin_required'))
  await refreshMe()
  try {
    phases.value = await loadPhases()
    if (team.value) {
      await loadSubmissions()
      const [{ data: memberRows }, ...counts] = await Promise.all([
        supabase.rpc('team_members', { p_team_id: team.value.id }),
        ...phases.value.filter(p => p.status === 'open').map(p => supabase.rpc('team_daily_count', { p_phase_slug: p.slug }).then(r => [p.slug, Number(r.data ?? 0)] as const)),
      ])
      members.value = memberRows ?? []
      quota.value = Object.fromEntries(counts)
      watcher.start(team.value.id)
    }
  } finally { loading.value = false }
})
</script>

<template>
  <DashShell :kicker="t('dash.title')" :title="tf('dash.welcome', { name: me?.name || me?.email || '' })">
    <p v-if="loading" class="text3 text-sm">{{ t('dash.loading') }}</p>
    <div v-else class="dash-grid">
      <div>
        <div v-if="!team" class="panel">
          <div class="hd"><h2>{{ t('dash.no_team_title') }}</h2></div>
          <p class="text2">{{ t('dash.no_team') }}</p>
          <p class="mt-5"><router-link class="btn primary sm" to="/team">{{ t('nav.team') }} →</router-link></p>
        </div>
        <div v-else class="panel">
          <div class="hd"><h2>{{ t('dash.recent') }}</h2><router-link class="label accent" to="/submissions">{{ t('dash.all_submissions') }} →</router-link></div>
          <div v-if="submissions.length" class="table-wrap">
            <table class="data-table">
              <thead><tr><th>{{ t('subs.id') }}</th><th>{{ t('subs.phase') }}</th><th>{{ t('subs.kind') }}</th><th>{{ t('common.status') }}</th><th class="r">{{ t('subs.score') }}</th><th>{{ t('subs.when') }}</th></tr></thead>
              <tbody>
                <tr v-for="s in submissions" :key="s.id">
                  <td><router-link class="accent-l m" :to="`/submissions/${s.id}`">#{{ s.id }}</router-link></td>
                  <td>{{ s.phases ? pick(s.phases.name_en, s.phases.name_zh) : '—' }}</td>
                  <td>{{ t(`kind.${s.kind}`) }}</td>
                  <td><StatusPill :status="s.status" /></td>
                  <td class="r m">{{ num(s.score) }}</td>
                  <td class="m xs">{{ fmtUtc(s.created_at, { short: true }) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="text2">{{ t('subs.empty') }}</p>
          <p class="mt-5"><router-link class="btn primary sm" to="/submit">{{ t('dash.new_submission') }} →</router-link></p>
        </div>

        <div class="panel mt-8">
          <div class="hd"><h2>{{ t('dash.phases') }}</h2><router-link class="label accent" to="/leaderboard">{{ t('dash.quick.board') }} →</router-link></div>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>{{ t('leaderboard.phase') }}</th><th>{{ t('common.status') }}</th><th>{{ t('common.utc') }}</th><th class="r">{{ t('rules_page.daily') }}</th><th class="r">{{ t('dash.quota') }}</th></tr></thead>
              <tbody>
                <tr v-for="p in phases" :key="p.id">
                  <td>{{ pick(p.name_en, p.name_zh) }}</td>
                  <td><StatusPill :status="p.status" ns="leaderboard.status" /></td>
                  <td class="m xs whitespace-nowrap">{{ fmtUtc(p.starts_at, { short: true }) }} → {{ fmtUtc(p.ends_at, { short: true }) }}</td>
                  <td class="r m">{{ p.daily_limit }}</td>
                  <td class="r m">{{ p.status === 'open' && team ? `${quota[p.slug] ?? 0} / ${p.daily_limit}` : '—' }}</td>
                </tr>
                <tr v-if="!phases.length"><td colspan="5" class="text3">{{ t('leaderboard.no_phases') }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <div v-if="team" class="panel">
          <div class="hd"><h2>{{ t('dash.team') }}</h2><router-link class="label accent" to="/team">{{ t('nav.team') }} →</router-link></div>
          <p class="text-2xl font-semibold tracking-[-.03em] text-text-primary">{{ team.name }}</p>
          <dl class="kv mt-4">
            <dt>{{ t('dash.members') }}</dt><dd>{{ team.member_count }} / {{ team.max_size }}</dd>
            <dt>{{ t('team.invite_code') }}</dt><dd class="m">{{ team.invite_code }}</dd>
          </dl>
          <ul class="text2 mt-4 text-sm">
            <li v-for="m in members" :key="m.id">{{ m.name }}<template v-if="m.is_leader"> · <span class="label accent">{{ t('team.leader') }}</span></template></li>
          </ul>
        </div>
        <div class="panel mt-8">
          <div class="hd"><h2>{{ t('resources.kicker') }}</h2></div>
          <div class="flex flex-col gap-2">
            <a class="btn sm" :href="appUrl('/downloads/agent-observer-starter-kit.zip')" download>{{ t('dash.quick.kit') }} ↓</a>
            <router-link class="btn sm" to="/docs">{{ t('dash.quick.docs') }} →</router-link>
            <a class="btn sm" :href="appUrl('/skill.md')" target="_blank" rel="noopener">SKILL.md →</a>
          </div>
        </div>
      </div>
    </div>
  </DashShell>
</template>
