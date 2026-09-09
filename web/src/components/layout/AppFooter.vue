<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
const { t } = useI18n()
</script>

<template>
  <footer class="cosmos-footer border-t py-10 text-white">
    <div class="relative z-10 mx-auto max-w-[1600px] px-5 md:px-10 xl:px-14">
      <div class="flex flex-col justify-between gap-8 md:flex-row md:items-end">
        <div>
          <div class="text-2xl font-semibold tracking-[-.05em] text-[#f5f5f5]">OPEN <span class="text-[#315efb]">/</span> OBSERVER</div>
          <div class="mt-3 max-w-xl text-xs leading-relaxed text-white/45">{{ t('footer.copyright') }}</div>
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
