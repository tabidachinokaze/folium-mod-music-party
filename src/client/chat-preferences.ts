import type { FoliumSettingsSectionDef } from '../../vendor/folium/contract'
import type { Folium } from './host'

// src/client/chat-preferences.ts
export type ChatPreferenceValues = Readonly<{
  position: 'panel' | 'bottom-left'
  danmaku: boolean
  peekSeconds: number
}>
export interface ChatPreferences {
  get(): ChatPreferenceValues
  set(patch: Partial<ChatPreferenceValues>): void
  subscribe(listener: () => void): () => void
  dispose(): void
}

const section: FoliumSettingsSectionDef = {
  id: 'chat',
  label: { 'zh-CN': '聊天设置', en: 'Chat settings' },
  settings: [
    {
      key: 'position',
      type: 'select',
      label: { 'zh-CN': '聊天位置', en: 'Chat position' },
      defaultValue: 'panel',
      options: [
        { value: 'panel', label: { 'zh-CN': '面板内', en: 'In panel' } },
        { value: 'bottom-left', label: { 'zh-CN': '左下角', en: 'Bottom left' } },
      ],
    },
    {
      key: 'danmaku',
      type: 'boolean',
      label: { 'zh-CN': '启用弹幕', en: 'Show danmaku' },
      defaultValue: false,
    },
    {
      key: 'peekSeconds',
      type: 'number',
      label: { 'zh-CN': '新消息显示时长', en: 'New message preview duration' },
      defaultValue: 5,
      min: 1,
      max: 30,
      step: 1,
    },
  ],
}
const seconds = (value: number) => Math.max(1, Math.min(30, Math.round(value)))
function normalize(values: Readonly<Record<string, unknown>>): ChatPreferenceValues {
  return Object.freeze({
    position: values.position === 'bottom-left' ? 'bottom-left' : 'panel',
    danmaku: values.danmaku === true,
    peekSeconds:
      typeof values.peekSeconds === 'number' && Number.isFinite(values.peekSeconds)
        ? seconds(values.peekSeconds)
        : 5,
  })
}

export function createChatPreferences(folium: Folium): ChatPreferences {
  const handle = folium.registries.settingsSections.register(section),
    listeners = new Set<() => void>()
  let values = normalize(handle.params.get()),
    disposed = false
  const sync = () => {
    if (disposed) return
    const next = normalize(handle.params.get())
    if (
      next.position === values.position &&
      next.danmaku === values.danmaku &&
      next.peekSeconds === values.peekSeconds
    )
      return
    values = next
    for (const listener of [...listeners]) listener()
  }
  const unsubscribe = handle.params.subscribe(sync)
  return {
    get: () => values,
    set(patch) {
      if (disposed) return
      const update: Record<string, unknown> = {}
      if (
        (patch.position === 'panel' || patch.position === 'bottom-left') &&
        patch.position !== values.position
      )
        update.position = patch.position
      if (typeof patch.danmaku === 'boolean' && patch.danmaku !== values.danmaku)
        update.danmaku = patch.danmaku
      if (typeof patch.peekSeconds === 'number' && Number.isFinite(patch.peekSeconds)) {
        const next = seconds(patch.peekSeconds)
        if (next !== values.peekSeconds) update.peekSeconds = next
      }
      if (Object.keys(update).length) {
        handle.params.set(update)
        sync()
      }
    },
    subscribe(listener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      listeners.clear()
      handle.unregister()
    },
  }
}
