import { ref } from 'vue'
import { isSupabaseConfigured } from '../lib/supabase'
import { loadPublicSettings } from '../lib/data'

const mechanicsPublic = ref(true)
const registrationDeadline = ref<string | null>(null)
let loaded: Promise<void> | null = null

export function usePublicSettings() {
  if (!loaded) {
    loaded = (async () => {
      if (!isSupabaseConfigured) return
      const settings = await loadPublicSettings()
      mechanicsPublic.value = settings.mechanicsPublic
      registrationDeadline.value = settings.registrationDeadline
    })()
  }
  return { mechanicsPublic, registrationDeadline }
}
