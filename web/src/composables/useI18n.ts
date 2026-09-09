import { ref, provide, inject, watch, type InjectionKey, type Ref } from 'vue'
import en from '../i18n/en'
import zh from '../i18n/zh'

type Messages = Record<string, any>
export type Locale = 'en' | 'zh'

export interface I18n {
  locale: Ref<Locale>
  t: (key: string) => any
  tf: (key: string, params: Record<string, string | number>) => string
  pick: <T>(english: T, chinese: T) => T
  toggleLocale: () => void
  setLocale: (value: Locale) => void
}

const I18N_KEY: InjectionKey<I18n> = Symbol('i18n')
const messages: Record<Locale, Messages> = { en, zh }
const STORAGE_KEY = 'agent-observer-locale'

function lookup(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

export function translate(locale: Locale, key: string): any {
  const primary = lookup(messages[locale], key)
  if (primary !== undefined) return primary
  const fallback = lookup(messages[locale === 'zh' ? 'en' : 'zh'], key)
  return fallback !== undefined ? fallback : key
}

export function interpolate(template: unknown, params: Record<string, string | number>): string {
  const text = typeof template === 'string' ? template : String(template)
  return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

export function provideI18n(): I18n {
  const saved = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) || window.localStorage.getItem('cosmos-locale') : null
  const locale = ref<Locale>(saved === 'en' || saved === 'zh' ? saved : 'zh')

  if (typeof document !== 'undefined') {
    watch(locale, (value) => {
      document.documentElement.lang = value === 'zh' ? 'zh-CN' : 'en'
      document.title = translate(value, 'meta.title')
      const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
      if (description) description.content = translate(value, 'meta.description')
      window.localStorage.setItem(STORAGE_KEY, value)
    }, { immediate: true })
  }

  const t = (key: string) => translate(locale.value, key)
  const tf = (key: string, params: Record<string, string | number>) => interpolate(translate(locale.value, key), params)
  const pick = <T>(english: T, chinese: T): T => (locale.value === 'zh' ? chinese : english)
  const setLocale = (value: Locale) => { locale.value = value }
  const toggleLocale = () => { locale.value = locale.value === 'en' ? 'zh' : 'en' }

  const api: I18n = { locale, t, tf, pick, toggleLocale, setLocale }
  provide(I18N_KEY, api)
  return api
}

export function useI18n(): I18n {
  const i18n = inject(I18N_KEY)
  if (!i18n) throw new Error('useI18n() called without provideI18n()')
  return i18n
}
