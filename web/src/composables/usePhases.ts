import { onMounted, ref } from 'vue'
import { isSupabaseConfigured } from '../lib/supabase'
import { loadPhases, type Phase } from '../lib/data'

export function usePhases(auto = true) {
  const phases = ref<Phase[]>([])
  const loading = ref(true)
  const error = ref<unknown>(null)
  async function reload() {
    loading.value = true
    error.value = null
    try { phases.value = isSupabaseConfigured ? await loadPhases() : [] }
    catch (e) { error.value = e; phases.value = [] }
    finally { loading.value = false }
  }
  if (auto) onMounted(reload)
  return { phases, loading, error, reload }
}
