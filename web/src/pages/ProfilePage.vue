<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n, type Locale } from '../composables/useI18n'
import { supabase } from '../lib/supabase'
import { describeError } from '../lib/errors'
import { useAuth } from '../stores/auth'
import { useFlash } from '../stores/flash'
import DashShell from '../components/layout/DashShell.vue'

const { t, locale, setLocale } = useI18n()
const i18n = useI18n()
const flash = useFlash()
const { me, refreshMe } = useAuth()
const form = ref({ name: '', github: '', affiliation: '', role: '', looking_for_team: false, locale: 'zh' as Locale })
const pw = ref({ password: '', password2: '' })
const busy = ref(false)
const pwBusy = ref(false)
const loading = ref(true)

onMounted(async () => {
  const profile = await refreshMe()
  if (profile) form.value = { name: profile.name ?? '', github: profile.github ?? '', affiliation: profile.affiliation ?? '', role: profile.role ?? '', looking_for_team: Boolean(profile.looking_for_team), locale: profile.locale === 'en' ? 'en' : profile.locale === 'zh' ? 'zh' : locale.value }
  loading.value = false
})

async function save() {
  if (!me.value) return
  if (!form.value.name.trim()) { flash.error(t('auth.errors.name_required')); return }
  busy.value = true
  try {
    const { error } = await supabase.from('profiles').update({
      name: form.value.name.trim(), github: form.value.github.trim().replace(/^@/, ''), affiliation: form.value.affiliation.trim(),
      role: form.value.role.trim(), looking_for_team: form.value.looking_for_team, locale: form.value.locale,
    }).eq('id', me.value.id)
    if (error) throw error
    setLocale(form.value.locale)
    await refreshMe()
    flash.success(t('flash.profile_saved'))
  } catch (e) { flash.error(describeError(e, i18n)) }
  finally { busy.value = false }
}

async function changePassword() {
  if (pw.value.password.length < 8) { flash.error(t('auth.errors.password_too_short')); return }
  if (pw.value.password !== pw.value.password2) { flash.error(t('auth.errors.password_mismatch')); return }
  pwBusy.value = true
  try {
    const { error } = await supabase.auth.updateUser({ password: pw.value.password })
    if (error) throw error
    pw.value = { password: '', password2: '' }
    flash.success(t('flash.password_changed'))
  } catch (e) { flash.error(describeError(e, i18n, ['auth.errors'])) }
  finally { pwBusy.value = false }
}
</script>

<template>
  <DashShell :kicker="t('dash.title')" :title="t('profile.title')">
    <p v-if="loading" class="text3 text-sm">{{ t('common.loading') }}</p>
    <div v-else class="dash-grid">
      <div class="panel">
        <div class="hd"><h2>{{ t('profile.title') }}</h2><span class="m text3 text-sm">{{ me?.email }}</span></div>
        <form @submit.prevent="save" novalidate>
          <div class="grid-form">
            <label class="field"><span>{{ t('auth.name') }}</span><input data-testid="profile-name" v-model="form.name" type="text" required maxlength="120"></label>
            <label class="field"><span>{{ t('auth.github') }}</span><input v-model="form.github" type="text" maxlength="120"></label>
            <label class="field"><span>{{ t('auth.affiliation') }}</span><input v-model="form.affiliation" type="text" maxlength="200"></label>
            <label class="field"><span>{{ t('profile.role') }}</span><input v-model="form.role" type="text" maxlength="120"></label>
            <label class="field"><span>{{ t('profile.language') }}</span>
              <select v-model="form.locale"><option value="zh">中文</option><option value="en">English</option></select>
            </label>
          </div>
          <label class="check"><input v-model="form.looking_for_team" type="checkbox"> {{ t('auth.looking_for_team') }}</label>
          <p class="help mb-4">{{ t('profile.email_note') }} {{ t('profile.locale_note') }}</p>
          <button data-testid="profile-save" class="btn primary sm" type="submit" :disabled="busy">{{ t('profile.save') }}</button>
        </form>
      </div>
      <div>
        <div class="panel">
          <div class="hd"><h2>{{ t('profile.password_title') }}</h2></div>
          <form @submit.prevent="changePassword" novalidate>
            <label class="field"><span>{{ t('profile.new') }}</span><input v-model="pw.password" type="password" minlength="8" autocomplete="new-password"></label>
            <label class="field"><span>{{ t('profile.new2') }}</span><input v-model="pw.password2" type="password" minlength="8" autocomplete="new-password"></label>
            <button class="btn sm" type="submit" :disabled="pwBusy">{{ t('profile.change') }}</button>
          </form>
        </div>
      </div>
    </div>
  </DashShell>
</template>
