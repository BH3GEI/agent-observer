<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
const props = defineProps<{ status: string; ns?: string; testid?: string; live?: boolean }>()
const { t } = useI18n()
const label = () => {
  const key = `${props.ns ?? 'status'}.${props.status}`
  const value = t(key)
  return value === key ? props.status : value
}
</script>

<template>
  <span class="pill" :class="status" :data-testid="testid" :aria-live="live ? 'polite' : undefined" :role="live ? 'status' : undefined">{{ label() }}</span>
</template>
