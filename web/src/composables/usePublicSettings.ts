import { ref } from 'vue'
import { isSupabaseConfigured } from '../lib/supabase'
import { loadPublicSettings } from '../lib/data'

// Fail closed: the finals mechanics stay hidden until the switch is confirmed open.
const mechanicsPublic = ref(false)
const registrationDeadline = ref<string | null>(null)
let loaded: Promise<void> | null = null

export function usePublicSettings() {
  if (!loaded) {
    loaded = (async () => {
      if (!isSupabaseConfigured) return
      try {
        const settings = await loadPublicSettings()
        mechanicsPublic.value = settings.mechanicsPublic
        registrationDeadline.value = settings.registrationDeadline
      } catch {
        loaded = null // let a later caller retry instead of pinning the defaults forever
      }
    })()
  }
  return { mechanicsPublic, registrationDeadline }
}
