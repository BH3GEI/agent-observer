<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { supabase } from '../../lib/supabase'
import { loadRegistrationOpen } from '../../lib/data'
import { publicSiteUrl, BASE_URL } from '../../composables/api'
import { useRegistrationOpen } from '../../composables/useRegistrationOpen'
import { useAdmin } from '../../composables/useAdmin'
import DashShell from '../../components/layout/DashShell.vue'

const { t, busy, run } = useAdmin()
const { reload } = useRegistrationOpen()
const registrationOpen = ref(true)
const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '')

onMounted(async () => { registrationOpen.value = await loadRegistrationOpen() })
async function save() {
  const ok = await run(async () => {
    const { error } = await supabase.from('site_settings').upsert({ key: 'registration_open', value: registrationOpen.value }, { onConflict: 'key' })
    if (error) throw error
  }, t('admin.settings.saved'))
  if (ok) await reload()
}
</script>

<template>
  <DashShell admin :kicker="t('admin.kicker')" :title="t('admin.nav.settings')">
    <form class="panel max-w-2xl" @submit.prevent="save">
      <label class="check"><input v-model="registrationOpen" type="checkbox"> {{ t('admin.settings.registration_open') }}</label>
      <button class="btn primary sm" type="submit" :disabled="busy">{{ t('common.save') }}</button>
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
