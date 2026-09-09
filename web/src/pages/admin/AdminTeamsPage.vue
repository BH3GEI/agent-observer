<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAdmin } from '../../composables/useAdmin'
import DashShell from '../../components/layout/DashShell.vue'
import SkeletonRows from '../../components/layout/SkeletonRows.vue'

const { t, busy, rpc, run } = useAdmin()
const rows = ref<any[]>([])
const loading = ref(true)
const renames = ref<Record<string, string>>({})

async function load() { rows.value = (await rpc<any[]>('admin_teams')) ?? [] }
async function action(id: string, name: string, value: string | null = null) {
  if (name === 'rename' && !value?.trim()) return
  const ok = await run(() => rpc('admin_set_team', { p_team_id: id, p_action: name, p_value: value }), t('admin.done'), ['team.errors'])
  if (ok) { renames.value[id] = ''; await load() }
}
onMounted(async () => { try { await load() } finally { loading.value = false } })
</script>

<template>
  <DashShell admin :kicker="t('admin.kicker')" :title="t('admin.nav.teams')">
    <div class="table-wrap mt-2">
      <table class="data-table">
        <thead><tr><th>{{ t('common.name') }}</th><th class="r">{{ t('admin.teams.members') }}</th><th class="r">{{ t('admin.teams.subs') }}</th><th>{{ t('admin.teams.flags') }}</th><th>{{ t('admin.teams.code') }}</th><th>{{ t('common.actions') }}</th></tr></thead>
        <tbody>
          <tr v-for="team in rows" :key="team.id">
            <td>{{ team.name }}<div class="text3 text-xs">{{ team.slug }} {{ team.github_repo }}</div></td>
            <td class="r m">{{ team.member_count }}/{{ team.max_size }}</td>
            <td class="r m">{{ team.submission_count }}</td>
            <td><span v-if="team.is_hidden" class="pill">{{ t('admin.teams.hidden') }}</span> <span v-if="team.is_locked" class="pill">{{ t('admin.teams.locked') }}</span></td>
            <td class="m">{{ team.invite_code }}</td>
            <td>
              <div class="actions-inline">
                <button type="button" class="copy-btn" :disabled="busy" @click="action(team.id, 'toggle_hidden')">{{ team.is_hidden ? t('admin.teams.show') : t('admin.teams.hide') }}</button>
                <button type="button" class="copy-btn" :disabled="busy" @click="action(team.id, 'toggle_locked')">{{ team.is_locked ? t('admin.teams.unlock') : t('admin.teams.lock') }}</button>
                <input v-model="renames[team.id]" type="text" class="input w-36 px-2 py-1 text-sm" :placeholder="t('admin.teams.rename_placeholder')">
                <button type="button" class="copy-btn" :disabled="busy" @click="action(team.id, 'rename', renames[team.id] ?? '')">{{ t('admin.teams.rename') }}</button>
              </div>
            </td>
          </tr>
          <tr v-if="loading"><td colspan="6" class="p-0"><SkeletonRows :rows="5" :cols="4" :label="t('common.loading')" /></td></tr>
          <tr v-else-if="!rows.length"><td colspan="6" class="text3">{{ t('common.no_data') }}</td></tr>
        </tbody>
      </table>
    </div>
  </DashShell>
</template>
