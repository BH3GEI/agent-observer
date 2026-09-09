<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from '../composables/useI18n'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errors'
import { useAuth } from '../stores/auth'
import { useFlash } from '../stores/flash'
import DashShell from '../components/layout/DashShell.vue'

interface Member { id: string; name: string; github: string | null; affiliation: string | null; is_leader: boolean }
interface OpenTeam { id: string; name: string; member_count: number; max_size: number; created_at: string }

const { t, tf } = useI18n()
const i18n = useI18n()
const flash = useFlash()
const { me, team, refreshMe } = useAuth()
const members = ref<Member[]>([])
const openTeams = ref<OpenTeam[]>([])
const busy = ref(false)
const loading = ref(true)
const copied = ref(false)
const createForm = ref({ name: '', max_size: 4, github_repo: '', project_idea: '' })
const joinForm = ref({ code: '' })
const editForm = ref({ max_size: 4, github_repo: '', project_idea: '', is_locked: false })
const isLeader = computed(() => Boolean(team.value && me.value && team.value.leader_id === me.value.id))

const errorText = (e: unknown) => describeError(e, i18n, ['team.errors', 'team'])

async function load() {
  loading.value = true
  try {
    await refreshMe()
    if (team.value) {
      const { data } = await supabase.rpc('team_members', { p_team_id: team.value.id })
      members.value = (data ?? []) as Member[]
      editForm.value = { max_size: team.value.max_size, github_repo: team.value.github_repo ?? '', project_idea: team.value.project_idea ?? '', is_locked: team.value.is_locked }
    } else {
      const { data } = await supabase.rpc('open_teams')
      openTeams.value = (data ?? []) as OpenTeam[]
    }
  } finally { loading.value = false }
}

async function run(action: () => Promise<unknown>, success?: string) {
  busy.value = true
  try {
    await action()
    if (success) flash.success(success)
    await load()
  } catch (e) { flash.error(errorText(e)) }
  finally { busy.value = false }
}
const rpc = async (name: string, args?: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

const createTeam = () => run(() => rpc('create_team', { p_name: createForm.value.name.trim(), p_max_size: Number(createForm.value.max_size), p_project_idea: createForm.value.project_idea.trim(), p_github_repo: createForm.value.github_repo.trim() }), t('flash.team_created'))
const joinTeam = () => run(async () => {
  await rpc('join_team', { p_invite_code: joinForm.value.code.trim().toUpperCase() })
  const fresh = await refreshMe()
  flash.success(tf('flash.team_joined', { name: fresh?.team?.name ?? '' }))
})
const saveTeam = () => run(() => rpc('update_team', { p_project_idea: editForm.value.project_idea.trim(), p_github_repo: editForm.value.github_repo.trim(), p_max_size: Number(editForm.value.max_size), p_is_locked: editForm.value.is_locked }), t('flash.team_saved'))
const regenerate = () => run(() => rpc('regenerate_invite_code'), t('team.code_regenerated'))
const transfer = (id: string) => { if (window.confirm(t('team.transfer_confirm'))) void run(() => rpc('transfer_leadership', { p_user_id: id }), t('flash.team_saved')) }
const kick = (id: string) => { if (window.confirm(t('team.kick_confirm'))) void run(() => rpc('remove_member', { p_user_id: id }), t('flash.team_saved')) }
const leave = () => { if (window.confirm(t('team.leave_confirm'))) void run(() => rpc('leave_team'), t('flash.team_left')) }
const disband = () => { if (window.confirm(t('team.disband_confirm'))) void run(() => rpc('disband_team'), t('flash.team_disbanded')) }

async function copyCode() {
  if (!team.value) return
  try { await navigator.clipboard.writeText(team.value.invite_code); copied.value = true; window.setTimeout(() => { copied.value = false }, 2000) } catch { /* clipboard unavailable */ }
}

onMounted(load)
</script>

<template>
  <DashShell :kicker="t('dash.title')" :title="t('team.title')">
    <p v-if="loading" class="text3 text-sm">{{ t('common.loading') }}</p>

    <div v-else-if="team" class="dash-grid">
      <div class="panel">
        <div class="hd"><h2>{{ team.name }}</h2><span class="label">{{ members.length }} / {{ team.max_size }}<template v-if="team.is_locked"> · {{ t('team.locked') }}</template></span></div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>{{ t('common.name') }}</th><th>{{ t('auth.github') }}</th><th>{{ t('auth.affiliation') }}</th><th></th></tr></thead>
            <tbody>
              <tr v-for="m in members" :key="m.id">
                <td>{{ m.name }} <span v-if="m.is_leader" class="pill accent ml-1">{{ t('team.leader') }}</span></td>
                <td class="m text-sm">{{ m.github || '—' }}</td>
                <td class="text-sm">{{ m.affiliation || '—' }}</td>
                <td class="r">
                  <div v-if="isLeader && m.id !== me?.id" class="actions-inline justify-end">
                    <button type="button" class="copy-btn" :disabled="busy" @click="transfer(m.id)">{{ t('team.transfer') }}</button>
                    <button type="button" class="copy-btn" :disabled="busy" @click="kick(m.id)">{{ t('team.kick') }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-if="isLeader">
          <div class="hd mt-10"><h3>{{ t('common.save') }}</h3></div>
          <form @submit.prevent="saveTeam">
            <div class="grid-form">
              <label class="field"><span>{{ t('team.max_size') }}</span><input v-model.number="editForm.max_size" type="number" :min="members.length" max="8"></label>
              <label class="field"><span>{{ t('team.github_repo') }}</span><input v-model="editForm.github_repo" type="text"></label>
              <label class="field full"><span>{{ t('team.project_idea') }}</span><textarea v-model="editForm.project_idea"></textarea></label>
            </div>
            <label class="check"><input v-model="editForm.is_locked" type="checkbox"> {{ t('team.locked') }}</label>
            <button class="btn primary sm" type="submit" :disabled="busy">{{ t('common.save') }}</button>
          </form>
        </template>
        <dl v-else class="kv mt-8">
          <dt>{{ t('team.github_repo') }}</dt><dd>{{ team.github_repo || '—' }}</dd>
          <dt>{{ t('team.project_idea') }}</dt><dd class="whitespace-pre-line">{{ team.project_idea || '—' }}</dd>
        </dl>
      </div>

      <div>
        <div class="panel">
          <div class="hd"><h2>{{ t('team.invite_code') }}</h2></div>
          <p class="text2 text-sm">{{ t('team.invite_lede') }}</p>
          <div class="token mt-4 text-[1.4rem] tracking-[.2em]" data-testid="team-invite-code">{{ team.invite_code }}</div>
          <div class="actions-inline mt-4">
            <button type="button" class="copy-btn" @click="copyCode">{{ copied ? t('common.copied') : t('common.copy') }}</button>
            <button v-if="isLeader" type="button" class="copy-btn" :disabled="busy" @click="regenerate">{{ t('team.regenerate') }}</button>
          </div>
        </div>
        <div class="panel mt-8">
          <div class="hd"><h2>{{ t('common.actions') }}</h2></div>
          <div class="actions-inline">
            <button type="button" class="btn sm" :disabled="busy" @click="leave">{{ t('team.leave') }}</button>
            <button v-if="isLeader" type="button" class="btn sm danger" :disabled="busy" @click="disband">{{ t('team.disband') }}</button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="dash-grid">
      <div class="panel">
        <div class="hd"><h2>{{ t('team.create_title') }}</h2></div>
        <p class="text2 mb-5 text-sm">{{ t('team.solo_hint') }}</p>
        <form @submit.prevent="createTeam">
          <div class="grid-form">
            <label class="field"><span>{{ t('team.name') }}</span><input data-testid="team-name-input" v-model="createForm.name" type="text" required minlength="2" maxlength="60"></label>
            <label class="field"><span>{{ t('team.max_size') }}</span><input v-model.number="createForm.max_size" type="number" min="1" max="8"></label>
            <label class="field"><span>{{ t('team.github_repo') }}</span><input v-model="createForm.github_repo" type="text"></label>
            <label class="field"><span>{{ t('team.project_idea') }}</span><input v-model="createForm.project_idea" type="text"></label>
          </div>
          <button data-testid="team-create" class="btn primary sm" type="submit" :disabled="busy">{{ t('team.create') }} →</button>
        </form>
      </div>
      <div>
        <div class="panel">
          <div class="hd"><h2>{{ t('team.join_title') }}</h2></div>
          <form @submit.prevent="joinTeam">
            <label class="field"><span>{{ t('team.invite_code') }}</span><input data-testid="team-join-code" v-model="joinForm.code" type="text" required class="mono uppercase tracking-[.15em]" autocomplete="off"></label>
            <button data-testid="team-join" class="btn sm" type="submit" :disabled="busy">{{ t('team.join') }} →</button>
          </form>
        </div>
        <div class="panel mt-8">
          <div class="hd"><h2>{{ t('team.open_teams') }}</h2></div>
          <ul v-if="openTeams.length">
            <li v-for="ot in openTeams" :key="ot.id" class="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle py-2 text-sm">
              <span>{{ ot.name }} <span class="text3">· {{ ot.member_count }}/{{ ot.max_size }}</span></span>
              <span class="text3 text-xs">{{ t('team.ask_code') }}</span>
            </li>
          </ul>
          <p v-else class="text2 text-sm">{{ t('team.no_open_teams') }}</p>
        </div>
      </div>
    </div>
  </DashShell>
</template>
