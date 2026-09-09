<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'

export interface TocItem { id: string; text: string; level: number }
const props = defineProps<{ source: string }>()
const emit = defineEmits<{ toc: [items: TocItem[]] }>()
const root = ref<HTMLElement | null>(null)
const html = computed(() => marked.parse(props.source, { async: false, gfm: true, breaks: false }) as string)

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section'
}

function decorate() {
  const items: TocItem[] = []
  const seen = new Set<string>()
  root.value?.querySelectorAll<HTMLElement>('h2, h3').forEach(heading => {
    const text = heading.textContent?.trim() ?? ''
    let id = slugify(text)
    while (seen.has(id)) id = `${id}-x`
    seen.add(id)
    heading.id = id
    items.push({ id, text, level: heading.tagName === 'H2' ? 2 : 3 })
  })
  root.querySelectorAll('pre').forEach((pre) => { if (!pre.hasAttribute('tabindex')) pre.setAttribute('tabindex', '0') })
  emit('toc', items)
}

watch(html, () => { void nextTick(decorate) })
onMounted(decorate)
</script>

<template>
  <article ref="root" class="prose" v-html="html"></article>
</template>
