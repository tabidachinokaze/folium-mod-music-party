import { enPickers } from './locales/en-pickers'
import { enPrivate } from './locales/en-private'
import { enRoom } from './locales/en-room'
import { enRuntime } from './locales/en-runtime'
import { enErrors } from './locales/en-errors'

// src/client/i18n.ts
type Locale = 'zh-CN' | 'en'
type Params = Record<string, string | number>
const english = { ...enErrors, ...enRuntime, ...enRoom, ...enPrivate, ...enPickers }
let fallbackLocale: Locale = 'zh-CN'
const normalize = (locale: string): Locale => (/^zh(?:-|$)/i.test(locale) ? 'zh-CN' : 'en')
export function setLocale(locale: string) {
  fallbackLocale = normalize(locale || 'zh-CN')
}
export function getLocale(): Locale {
  return typeof document !== 'undefined' && document.documentElement.lang
    ? normalize(document.documentElement.lang)
    : fallbackLocale
}
export function t(source: string, values: Params = {}): string {
  const text = getLocale() === 'en' && Object.hasOwn(english, source) ? english[source] : source
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : match,
  )
}
