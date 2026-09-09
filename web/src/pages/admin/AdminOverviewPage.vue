<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'
import { fmtUtc, num } from '../../lib/format'
import { useAdmin } from '../../composables/useAdmin'
import DashShell from '../../components/layout/DashShell.vue'
import StatusPill from '../../components/layout/StatusPill.vue'

const { t, rpc, report } = useAdmin()
const stats = ref<Record<string, number>>({})
const recent = ref<any[]>([])
const audit = ref<any[]>([])
const keys = ['users', 'teams', 'submissions', 'queued', 'scored', 'failed']

onMounted(async () => {
  try {
    const [s, r, a] = await Promise.all([
      rpc<Record<string, number>>('admin_stats'),
      supabase.from('submissions').select('id, kind, status, score, created_at, teams(name), phases(slug)').order('created_at', { ascending: false }).limit(15),
      supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(25),
    ])
    stats.value = s ?? {}
    recent.value = r.data ?? []
    audit.value = a.data ?? []
  } catch (e) { report(e) }
})
</script>

<template>
  <DashShell admin :kicker="t('admin.kicker')" :title="t('admin.nav.overview')">
    <div class="stats stats-6">
      <div v-for="k in keys" :key="k" class="stat"><b>{{ stats[k] ?? '—' }}</b><span>{{ t(`admin.stats.${k}`) }}</span></div>
    </div>
    <div class="dash-grid mt-10">
      <div class="panel">
        <div class="hd"><h2>{{ t('admin.recent') }}</h2><router-link class="label accent" to="/admin/submissions">{{ t('admin.all') }} →</router-link></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>#</th><th>{{ t('common.team') }}</th><th>{{ t('leaderboard.phase') }}</th><th>{{ t('subs.kind') }}</th><th>{{ t('common.status') }}</th><th class="r">{{ t('subs.score') }}</th><th>{{ t('subs.when') }}</th></tr></thead>
            <tbody>
              <tr v-for="s in recent" :key="s.id">
                <td><router-link class="accent-l m" :to="`/submissions/${s.id}`">{{ s.id }}</router-link></td>
                <td>{{ s.teams?.name ?? '—' }}</td><td class="m xs">{{ s.phases?.slug ?? '—' }}</td><td>{{ s.kind }}</td>
                <td><StatusPill :status="s.status" /></td><td class="r m">{{ num(s.score) }}</td><td class="m xs">{{ fmtUtc(s.created_at, { short: true }) }}</td>
              </tr>
              <tr v-if="!recent.length"><td colspan="7" class="text3">{{ t('common.no_data') }}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="hd"><h2>{{ t('admin.audit') }}</h2></div>
        <ul class="text-sm">
          <li v-for="a in audit" :key="a.id" class="border-b border-border-subtle py-2"><span class="m text3 text-xs">{{ fmtUtc(a.created_at, { short: true }) }}</span> {{ a.action }} <span class="text3 text-xs break-all">{{ typeof a.detail === 'string' ? a.detail : JSON.stringify(a.detail) }}</span></li>
          <li v-if="!audit.length" class="text3">{{ t('common.no_data') }}</li>
        </ul>
      </div>
    </div>
  </DashShell>
</template>
