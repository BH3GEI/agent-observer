<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { readObjectText } from '../../lib/storage'

/** Loads the organizer-style decision_replay.html from the private results bucket and shows it in a sandboxed iframe. */
const props = defineProps<{ path: string }>()
const { t } = useI18n()
const html = ref<string | null>(null)
const loading = ref(false)
const failed = ref(false)
let blobUrl: string | null = null

async function open() {
  if (html.value || loading.value) return
  loading.value = true
  failed.value = false
  try { html.value = await readObjectText('results', props.path) }
  catch { failed.value = true }
  finally { loading.value = false }
}
function close() { html.value = null }
function openTab() {
  if (!html.value) return
  if (blobUrl) URL.revokeObjectURL(blobUrl)
  blobUrl = URL.createObjectURL(new Blob([html.value], { type: 'text/html' }))
  window.open(blobUrl, '_blank', 'noopener')
}
onUnmounted(() => { if (blobUrl) URL.revokeObjectURL(blobUrl) })
</script>

<template>
  <div class="replay-viewer" data-testid="replay-viewer">
    <p class="actions-inline">
      <button v-if="!html" type="button" class="btn sm primary" :disabled="loading" data-testid="replay-open" @click="open">{{ loading ? t('common.loading') : t('subs.replay.open') }} ▶</button>
      <template v-else>
        <button type="button" class="btn sm" data-testid="replay-new-tab" @click="openTab">{{ t('subs.replay.new_tab') }} ↗</button>
        <button type="button" class="btn sm" @click="close">{{ t('common.close') }}</button>
      </template>
      <span v-if="failed" class="text-sm text-[#ff6b6b]">{{ t('subs.download_failed') }}</span>
      <span class="text3 text-xs">{{ t('subs.replay.note') }}</span>
    </p>
    <div v-if="html" class="replay-frame-wrap mt-4">
      <iframe class="replay-frame" sandbox="allow-scripts" :srcdoc="html" :title="t('subs.replay.title')" data-testid="replay-frame"></iframe>
    </div>
  </div>
</template>

<style scoped>
.replay-frame-wrap { border: 1px solid rgba(255,255,255,.25); background: #000; }
.replay-frame { display: block; width: 100%; height: 820px; border: 0; background: #000; }
</style>
