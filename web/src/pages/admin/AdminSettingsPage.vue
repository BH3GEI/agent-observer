<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'
import { loadCreditsNote, loadPublicSettings } from '../../lib/data'
import { publicSiteUrl, BASE_URL } from '../../composables/api'
import { useRegistrationOpen } from '../../composables/useRegistrationOpen'
import { useAdmin } from '../../composables/useAdmin'
import DashShell from '../../components/layout/DashShell.vue'

const { t, busy, run } = useAdmin()
const { reload } = useRegistrationOpen()
const registrationOpen = ref(true)
const registrationDeadline = ref('')
const mechanicsPublic = ref(true)
const creditsNote = ref({ en: '', zh: '' })

const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '')

onMounted(async () => {
  const [settings, note, raw] = await Promise.all([
    loadPublicSettings(), loadCreditsNote(),
    supabase.from('site_settings').select('key, value').in('key', ['registration_open']),
  ])
  // the toggle edits the manual flag itself, not the deadline-derived state
  const manual = (raw.data ?? []).find(row => row.key === 'registration_open')?.value
  registrationOpen.value = !(manual === false || manual === 'false')
  registrationDeadline.value = toLocalInput(settings.registrationDeadline)
  mechanicsPublic.value = settings.mechanicsPublic
  creditsNote.value = note
})
async function save() {
  const ok = await run(async () => {
    const deadline: string | boolean = registrationDeadline.value ? new Date(registrationDeadline.value).toISOString() : false
    const { error } = await supabase.from('site_settings').upsert([
      { key: 'registration_open', value: registrationOpen.value },
      { key: 'registration_deadline', value: deadline },
      { key: 'mechanics_public', value: mechanicsPublic.value },
    ], { onConflict: 'key' })
    if (error) throw error
  }, t('admin.settings.saved'))
  if (ok) await reload()
}
async function saveCreditsNote() {
  await run(async () => {
    const value = { en: creditsNote.value.en.trim(), zh: creditsNote.value.zh.trim() }
    const { error } = await supabase.from('site_settings').upsert({ key: 'credits_note', value }, { onConflict: 'key' })
    if (error) throw error
  }, t('admin.settings.saved'))
}
</script>

<template>
  <DashShell admin :kicker="t('admin.kicker')" :title="t('admin.nav.settings')">
    <form class="panel max-w-2xl" @submit.prevent="save">
      <label class="check"><input v-model="registrationOpen" type="checkbox"> {{ t('admin.settings.registration_open') }}</label>
      <label class="field mt-4"><span>{{ t('admin.settings.registration_deadline') }}</span>
        <input v-model="registrationDeadline" type="datetime-local" data-testid="settings-deadline">
      </label>
      <label class="check"><input v-model="mechanicsPublic" type="checkbox" data-testid="settings-mechanics"> {{ t('admin.settings.mechanics_public') }}</label>
      <button class="btn primary sm" type="submit" :disabled="busy">{{ t('common.save') }}</button>
    </form>
    <form class="panel mt-8 max-w-2xl" @submit.prevent="saveCreditsNote">
      <div class="hd"><h2>{{ t('admin.settings.credits_note') }}</h2><router-link class="label accent" to="/admin/credits">{{ t('admin.nav.credits') }} →</router-link></div>
      <p class="text3 mb-4 text-sm">{{ t('admin.settings.credits_note_hint') }}</p>
      <label class="field"><span>{{ t('admin.settings.credits_note_en') }}</span><textarea data-testid="settings-credits-note-en" v-model="creditsNote.en" rows="3"></textarea></label>
      <label class="field"><span>{{ t('admin.settings.credits_note_zh') }}</span><textarea data-testid="settings-credits-note-zh" v-model="creditsNote.zh" rows="3"></textarea></label>
      <button data-testid="settings-credits-note-save" class="btn primary sm" type="submit" :disabled="busy">{{ t('common.save') }}</button>
    </form>
    <div class="panel mt-8 max-w-2xl">
      <div class="hd"><h2>{{ t('admin.settings.runtime') }}</h2></div>
      <dl class="kv">
        <dt>{{ t('admin.settings.site_url') }}</dt><dd class="m">{{ publicSiteUrl() }}</dd>
        <dt>{{ t('admin.settings.base_path') }}</dt><dd class="m">{{ BASE_URL }}</dd>
        <dt>{{ t('admin.settings.supabase_url') }}</dt><dd class="m">{{ supabaseUrl || '—' }}</dd>
      </dl>
    </div>
  </DashShell>
</template>
