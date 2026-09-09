<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from '../composables/useI18n'
import { publicSiteUrl } from '../composables/api'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { describeError } from '../lib/errors'
import { useAuth } from '../stores/auth'
import { useFlash } from '../stores/flash'
import { useRegistrationOpen } from '../composables/useRegistrationOpen'

type Mode = 'register' | 'login' | 'forgot'
const { t, locale } = useI18n()
const i18n = useI18n()
const route = useRoute()
const router = useRouter()
const flash = useFlash()
const { state, refreshMe } = useAuth()
const { registrationOpen } = useRegistrationOpen()

const mode = ref<Mode>(readMode())
const busy = ref(false)
const errors = ref<string[]>([])
const sent = ref(false)
const reg = ref({ name: '', email: '', password: '', password2: '', github: '', affiliation: '', looking_for_team: true, agree: false })
const login = ref({ email: '', password: '' })
const forgot = ref({ email: '' })
type Metric = { value: string; label: string }
const metrics = computed(() => t('hero.metrics') as Metric[])
const steps = computed(() => t('auth.steps') as string[])
const nextPath = computed(() => {
  const next = typeof route.query.next === 'string' ? route.query.next : ''
  return next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard'
})

function readMode(): Mode {
  const q = route.query.mode
  return q === 'login' || q === 'forgot' ? q : 'register'
}
watch(() => route.query.mode, () => { mode.value = readMode(); errors.value = [] })
watch(() => state.session, session => { if (session && !busy.value && route.path === '/register') router.replace(nextPath.value) }, { immediate: true })

function setMode(next: Mode) {
  errors.value = []
  sent.value = false
  router.replace({ path: '/register', query: { ...route.query, mode: next } })
}

async function submitRegister() {
  errors.value = []
  if (!reg.value.name.trim()) errors.value.push(t('auth.errors.name_required'))
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(reg.value.email.trim())) errors.value.push(t('auth.errors.email_invalid'))
  if (reg.value.password.length < 8) errors.value.push(t('auth.errors.password_too_short'))
  if (reg.value.password.length > 128) errors.value.push(t('auth.errors.password_too_long'))
  if (reg.value.password !== reg.value.password2) errors.value.push(t('auth.errors.password_mismatch'))
  if (!reg.value.agree) errors.value.push(t('auth.errors.agree_required'))
  if (!registrationOpen.value) errors.value.push(t('auth.errors.registration_closed'))
  if (!isSupabaseConfigured) errors.value.push(t('errors.not_configured'))
  if (errors.value.length) return
  busy.value = true
  try {
    const { data, error } = await supabase.auth.signUp({
      email: reg.value.email.trim(),
      password: reg.value.password,
      options: {
        emailRedirectTo: publicSiteUrl('/register?mode=login'),
        data: {
          name: reg.value.name.trim(),
          github: reg.value.github.trim().replace(/^@/, ''),
          affiliation: reg.value.affiliation.trim(),
          looking_for_team: reg.value.looking_for_team,
          locale: locale.value,
        },
      },
    })
    if (error) throw error
    if (data.user && Array.isArray((data.user as { identities?: unknown[] }).identities) && (data.user as { identities?: unknown[] }).identities!.length === 0) {
      errors.value = [t('auth.errors.email_taken')]
      return
    }
    if (data.session) {
      await refreshMe()
      flash.success(t('auth.register_done_session'))
      router.replace(nextPath.value)
    } else {
      flash.info(t('auth.register_done'))
      login.value.email = reg.value.email
      setMode('login')
    }
  } catch (e) {
    errors.value = [describeError(e, i18n, ['auth.errors'])]
  } finally { busy.value = false }
}

async function submitLogin() {
  errors.value = []
  if (!isSupabaseConfigured) { errors.value = [t('errors.not_configured')]; return }
  busy.value = true
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: login.value.email.trim(), password: login.value.password })
    if (error) throw error
    const me = await refreshMe()
    if (me?.is_banned) {
      await supabase.auth.signOut()
      errors.value = [t('auth.errors.banned')]
      return
    }
    flash.success(t('auth.login_done'))
    router.replace(nextPath.value)
  } catch (e) {
    errors.value = [describeError(e, i18n, ['auth.errors'])]
  } finally { busy.value = false }
}

async function submitForgot() {
  errors.value = []
  if (!isSupabaseConfigured) { errors.value = [t('errors.not_configured')]; return }
  busy.value = true
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(forgot.value.email.trim(), { redirectTo: publicSiteUrl('/reset') })
    if (error) throw error
    sent.value = true
    flash.success(t('auth.forgot_sent'))
  } catch (e) {
    errors.value = [describeError(e, i18n, ['auth.errors'])]
  } finally { busy.value = false }
}
</script>

<template>
  <main class="poster-canvas min-h-[80vh]">
    <section class="section"><div class="wrap">
      <div class="grid gap-12 lg:grid-cols-[.72fr_1.28fr] lg:gap-20">
        <aside>
          <span class="poster-kicker">{{ mode === 'register' ? t('nav.register') : mode === 'login' ? t('nav.login') : t('auth.forgot_title') }}</span>
          <h1 class="section-title mt-6">{{ mode === 'register' ? t('auth.register_title') : mode === 'login' ? t('auth.login_title') : t('auth.forgot_title') }}</h1>
          <p class="lede mt-6">{{ mode === 'register' ? t('auth.register_lede') : mode === 'login' ? t('auth.login_lede') : t('auth.forgot_lede') }}</p>
          <div class="mt-10 border-t poster-rule">
            <div v-for="(step, index) in steps" :key="index" class="grid grid-cols-[3rem_1fr] border-b poster-rule py-4">
              <span class="num">0{{ index + 1 }}</span><span class="text-sm text-text-secondary">{{ step }}</span>
            </div>
          </div>
          <div class="stats mt-10 hidden lg:grid" style="grid-template-columns:1fr">
            <div v-for="m in metrics" :key="m.label" class="stat" style="border-right:0;padding-left:0"><b>{{ m.value }}</b><span>{{ m.label }}</span></div>
          </div>
        </aside>

        <div class="form-card">
          <div v-if="!isSupabaseConfigured" class="errors">{{ t('errors.not_configured') }}</div>
          <div v-if="mode !== 'forgot'" class="tabs mb-8" role="tablist">
            <button type="button" role="tab" :class="{ active: mode === 'register' }" :aria-selected="mode === 'register'" @click="setMode('register')">{{ t('auth.tab_register') }}</button>
            <button type="button" role="tab" :class="{ active: mode === 'login' }" :aria-selected="mode === 'login'" @click="setMode('login')">{{ t('auth.tab_login') }}</button>
          </div>
          <div v-if="errors.length" class="errors" role="alert"><ul class="list-disc pl-5"><li v-for="e in errors" :key="e">{{ e }}</li></ul></div>

          <form v-if="mode === 'register'" @submit.prevent="submitRegister" novalidate>
            <div v-if="!registrationOpen" class="errors">{{ t('auth.closed_notice') }}</div>
            <div class="grid-form">
              <label class="field"><span>{{ t('auth.name') }}</span><input data-testid="reg-name" v-model="reg.name" type="text" required maxlength="120" autocomplete="name"></label>
              <label class="field"><span>{{ t('auth.email') }}</span><input data-testid="reg-email" v-model="reg.email" type="email" required autocomplete="email"></label>
              <label class="field"><span>{{ t('auth.password') }}</span><input data-testid="reg-password" v-model="reg.password" type="password" required minlength="8" autocomplete="new-password"></label>
              <label class="field"><span>{{ t('auth.password2') }}</span><input data-testid="reg-password2" v-model="reg.password2" type="password" required minlength="8" autocomplete="new-password"></label>
              <label class="field"><span>{{ t('auth.github') }} · {{ t('common.optional') }}</span><input v-model="reg.github" type="text" maxlength="120" autocomplete="username"></label>
              <label class="field"><span>{{ t('auth.affiliation') }} · {{ t('common.optional') }}</span><input v-model="reg.affiliation" type="text" maxlength="200" autocomplete="organization"></label>
            </div>
            <label class="check"><input v-model="reg.looking_for_team" type="checkbox"> {{ t('auth.looking_for_team') }}</label>
            <label class="check"><input data-testid="reg-agree" v-model="reg.agree" type="checkbox"> <span>{{ t('auth.agree') }} <router-link class="accent-l" to="/rules" target="_blank">{{ t('nav.rules') }} ↗</router-link></span></label>
            <button data-testid="reg-submit" class="btn primary" type="submit" :disabled="busy || !registrationOpen || !isSupabaseConfigured">{{ busy ? t('common.working') : t('auth.submit_register') }} →</button>
            <p class="text3 mt-6 text-sm">{{ t('auth.have_account') }} <button type="button" class="accent-l" @click="setMode('login')">{{ t('nav.login') }}</button></p>
          </form>

          <form v-else-if="mode === 'login'" @submit.prevent="submitLogin" novalidate>
            <label class="field"><span>{{ t('auth.email') }}</span><input data-testid="login-email" v-model="login.email" type="email" required autocomplete="email"></label>
            <label class="field"><span>{{ t('common.password') }}</span><input data-testid="login-password" v-model="login.password" type="password" required autocomplete="current-password"></label>
            <button data-testid="login-submit" class="btn primary" type="submit" :disabled="busy || !isSupabaseConfigured">{{ busy ? t('common.working') : t('auth.submit_login') }} →</button>
            <p class="text3 mt-6 text-sm">
              <button type="button" class="accent-l" @click="setMode('forgot')">{{ t('auth.forgot') }}</button>
              <template v-if="registrationOpen"> · {{ t('auth.no_account') }} <button type="button" class="accent-l" @click="setMode('register')">{{ t('nav.register') }}</button></template>
            </p>
          </form>

          <form v-else @submit.prevent="submitForgot" novalidate>
            <div v-if="sent" class="notice"><b>{{ t('auth.forgot_sent_title') }}</b><br>{{ t('auth.forgot_sent') }}</div>
            <label class="field"><span>{{ t('auth.email') }}</span><input v-model="forgot.email" type="email" required autocomplete="email"></label>
            <button class="btn primary" type="submit" :disabled="busy || !isSupabaseConfigured">{{ busy ? t('common.working') : t('auth.send_reset') }} →</button>
            <p class="text3 mt-6 text-sm"><button type="button" class="accent-l" @click="setMode('login')">← {{ t('auth.back_to_login') }}</button></p>
          </form>
        </div>
      </div>
    </div></section>
  </main>
</template>
