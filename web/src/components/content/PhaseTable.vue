<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { fmtUtc } from '../../lib/format'
import type { Phase } from '../../lib/data'
import StatusPill from '../layout/StatusPill.vue'
defineProps<{ phases: Phase[]; compact?: boolean }>()
const { t, pick } = useI18n()
</script>

<template>
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th>{{ t('leaderboard.phase') }}</th><th>{{ t('common.status') }}</th><th>{{ t('common.utc') }}</th>
          <template v-if="!compact"><th>{{ t('kind.results') }}</th><th>{{ t('kind.agent') }}</th></template>
          <th class="r">{{ t('rules_page.daily') }}</th>
          <th v-if="!compact">{{ t('rules_page.board') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in phases" :key="p.id">
          <td>{{ pick(p.name_en, p.name_zh) }}</td>
          <td><StatusPill :status="p.status" ns="leaderboard.status" /></td>
          <td class="m xs whitespace-nowrap">{{ fmtUtc(p.starts_at, { short: compact }) }} → {{ fmtUtc(p.ends_at, { short: compact }) }}</td>
          <template v-if="!compact"><td>{{ p.allow_results ? t('common.yes') : t('common.no') }}</td><td>{{ p.allow_agents ? t('common.yes') : t('common.no') }}</td></template>
          <td class="r m">{{ p.daily_limit }}</td>
          <td v-if="!compact" class="m xs">{{ p.leaderboard_mode }}</td>
        </tr>
        <tr v-if="!phases.length"><td :colspan="compact ? 4 : 7" class="text3">{{ t('leaderboard.no_phases') }}</td></tr>
      </tbody>
    </table>
  </div>
</template>
