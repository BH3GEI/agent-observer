<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '../../composables/useI18n'
import { useReplayClock } from '../../composables/useReplayClock'
const { t } = useI18n()
const { state, slots } = useReplayClock()
const slot = computed(() => slots[state.slotIndex] ?? slots[0]!)
const progressPct = computed(() => `${(state.progress * 100).toFixed(1)}%`)
</script>

<template>
  <footer class="cosmos-footer border-t text-white">
    <div class="slot-ticker" data-testid="slot-ticker" aria-hidden="true">
      <div class="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-1 px-5 md:px-10 xl:px-14">
        <span>900 S · {{ t('footer.ticker.per_slot') }}</span>
        <span class="text-[#78a6ff]">{{ t('footer.ticker.slot') }} {{ slot.slot }}</span>
        <span class="hidden sm:inline">{{ slot.night }} · {{ slot.open ? t('footer.ticker.open') : t('footer.ticker.closed') }}</span>
        <span class="slot-ticker-bar ml-auto" :class="{ 'is-static': state.reduced }"><i :style="{ width: progressPct }"></i></span>
      </div>
    </div>
    <div class="relative z-10 mx-auto max-w-[1600px] px-5 py-10 md:px-10 xl:px-14">
      <div class="flex flex-col justify-between gap-8 md:flex-row md:items-end">
        <div>
          <div class="text-2xl font-semibold tracking-[-.05em] text-[#f5f5f5]">OPEN <span class="text-[#315efb]">/</span> OBSERVER</div>
          <div class="mt-3 max-w-xl text-xs leading-relaxed text-white/60">{{ t('footer.copyright') }}</div>
        </div>
        <nav class="flex flex-wrap gap-5 font-mono text-xs uppercase tracking-[.12em] text-white/70">
          <router-link to="/rules" class="transition-colors hover:text-[#78a6ff]">{{ t('footer.links.rules') }}</router-link>
          <router-link to="/docs" class="transition-colors hover:text-[#78a6ff]">{{ t('footer.links.docs') }}</router-link>
          <router-link to="/announcements" class="transition-colors hover:text-[#78a6ff]">{{ t('nav.announcements') }}</router-link>
          <a :href="`mailto:${t('footer.contact_email')}`" class="transition-colors hover:text-[#78a6ff]">{{ t('footer.links.contact') }}</a>
          <a href="https://gosim.org" target="_blank" rel="noopener" class="transition-colors hover:text-[#78a6ff]">{{ t('footer.mainSite') }} ↗</a>
        </nav>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.slot-ticker {
  border-bottom: 1px solid rgba(255,255,255,.14);
  padding: .55rem 0;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: .66rem; letter-spacing: .12em; text-transform: uppercase; color: rgba(255,255,255,.5);
  font-variant-numeric: tabular-nums;
}
.slot-ticker-bar { position: relative; width: 6rem; height: 3px; background: rgba(255,255,255,.12); }
.slot-ticker-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: #315efb; }
.slot-ticker-bar.is-static i { width: 100% !important; }
</style>
