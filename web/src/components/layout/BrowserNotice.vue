<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { isSafari } from '../../lib/freshness'

// Safari keeps serving stale builds and renders parts of this site differently; say so once.
const { t } = useI18n()
const KEY = 'sac-browser-notice'
const open = ref(false)
const copied = ref(false)

onMounted(() => {
  let seen = false
  try { seen = localStorage.getItem(KEY) === '1' } catch { /* private mode: show it */ }
  if (!seen && isSafari()) open.value = true
})

function dismiss() {
  open.value = false
  try { localStorage.setItem(KEY, '1') } catch { /* private mode */ }
}
async function copyLink() {
  try {
    await navigator.clipboard.writeText(location.href)
    copied.value = true
    window.setTimeout(() => { copied.value = false }, 2000)
  } catch { /* clipboard blocked; the address bar still works */ }
}
</script>

<template>
  <div v-if="open" class="browser-notice" role="dialog" aria-modal="true" :aria-label="t('browser_notice.title')">
    <div class="browser-notice-card">
      <h2>{{ t('browser_notice.title') }}</h2>
      <p>{{ t('browser_notice.body') }}</p>
      <div class="browser-notice-actions">
        <button type="button" class="btn primary sm" @click="copyLink">{{ copied ? t('common.copied') : t('browser_notice.copy') }}</button>
        <button type="button" class="btn sm" data-testid="browser-notice-dismiss" @click="dismiss">{{ t('browser_notice.stay') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.browser-notice {
  position: fixed; inset: 0; z-index: 120;
  display: flex; align-items: center; justify-content: center;
  padding: 1.5rem;
  background: rgba(2, 5, 12, .72);
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.browser-notice-card {
  max-width: 30rem; width: 100%;
  border: 1px solid rgba(158, 173, 255, .3);
  background: linear-gradient(180deg, rgba(28, 36, 66, .96), rgba(10, 14, 28, .98));
  padding: 1.9rem 1.8rem 1.6rem;
  box-shadow: 0 24px 60px rgba(0, 0, 0, .55);
}
.browser-notice-card h2 {
  font-size: 1.3rem; font-weight: 650; letter-spacing: -.02em; color: #f5f7ff;
}
.browser-notice-card p {
  margin-top: .8rem; font-size: .93rem; line-height: 1.75; color: #c7d2ea;
}
.browser-notice-actions { display: flex; flex-wrap: wrap; gap: .6rem; margin-top: 1.4rem; }
</style>
