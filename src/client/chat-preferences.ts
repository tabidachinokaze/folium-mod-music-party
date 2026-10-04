import type { FoliumParam, FoliumSettingsSectionDef } from '../../vendor/folium/contract'
import type { Folium } from './host'

// src/client/chat-preferences.ts
export type DanmakuPreferenceValues = Readonly<{
  danmakuMode: 'scroll' | 'top' | 'bottom'
  danmakuArea: number
  danmakuOpacity: number
  danmakuBackgroundOpacity: number
  danmakuHoverOpacity: number
  danmakuFontSize: number
  danmakuSpeed: number
  danmakuFont: 'system' | 'heiti' | 'songti'
  danmakuBold: boolean
  danmakuTextStyle: 'shadow' | 'stroke' | 'none'
  danmakuText: boolean
  danmakuActivity: boolean
  danmakuMedia: boolean
  danmakuOverlap: boolean
  danmakuDedupe: boolean
}>
export type FloatingChatPreferenceValues = Readonly<{
  floatingOpacity: number
  floatingBubbleOpacity: number
  floatingInputOpacity: number
  floatingFontSize: number
  floatingLineHeight: number
}>
export type ChatPreferenceValues = Readonly<{
  position: 'panel' | 'bottom-left'
  danmaku: boolean
  peekSeconds: number
}> &
  FloatingChatPreferenceValues &
  DanmakuPreferenceValues
export interface ChatPreferences {
  get(): ChatPreferenceValues
  set(patch: Partial<ChatPreferenceValues>): void
  subscribe(listener: () => void): () => void
  dispose(): void
}
export const danmakuDefaults: DanmakuPreferenceValues = Object.freeze({
  danmakuMode: 'scroll',
  danmakuArea: 55,
  danmakuOpacity: 85,
  danmakuBackgroundOpacity: 12,
  danmakuHoverOpacity: 35,
  danmakuFontSize: 100,
  danmakuSpeed: 100,
  danmakuFont: 'system',
  danmakuBold: true,
  danmakuTextStyle: 'shadow',
  danmakuText: true,
  danmakuActivity: true,
  danmakuMedia: true,
  danmakuOverlap: false,
  danmakuDedupe: true,
})
export const danmakuRanges = {
  danmakuArea: { min: 10, max: 100, step: 1 },
  danmakuOpacity: { min: 10, max: 100, step: 1 },
  danmakuBackgroundOpacity: { min: 0, max: 100, step: 1 },
  danmakuHoverOpacity: { min: 0, max: 100, step: 1 },
  danmakuFontSize: { min: 75, max: 150, step: 1 },
  danmakuSpeed: { min: 50, max: 150, step: 1 },
} as const
export const floatingChatDefaults: FloatingChatPreferenceValues = Object.freeze({
  floatingOpacity: 100,
  floatingBubbleOpacity: 35,
  floatingInputOpacity: 45,
  floatingFontSize: 100,
  floatingLineHeight: 100,
})
export const floatingChatRanges = {
  floatingOpacity: { min: 20, max: 100, step: 1 },
  floatingBubbleOpacity: { min: 0, max: 100, step: 1 },
  floatingInputOpacity: { min: 0, max: 100, step: 1 },
  floatingFontSize: { min: 75, max: 150, step: 1 },
  floatingLineHeight: { min: 100, max: 160, step: 1 },
} as const
const label = (zh: string, en: string) => ({ 'zh-CN': zh, en })
const danmakuGroup = label('弹幕设置', 'Danmaku settings')
const floatingGroup = label('聊天显示', 'Chat display')
const section: FoliumSettingsSectionDef = {
  id: 'chat',
  label: label('聊天设置', 'Chat settings'),
  settings: [
    {
      key: 'position',
      type: 'select',
      label: label('聊天位置', 'Chat position'),
      defaultValue: 'panel',
      options: [
        { value: 'panel', label: label('面板内', 'In panel') },
        { value: 'bottom-left', label: label('左下角', 'Bottom left') },
      ],
    },
    {
      key: 'danmaku',
      type: 'boolean',
      label: label('启用弹幕', 'Show danmaku'),
      defaultValue: false,
    },
    {
      key: 'peekSeconds',
      type: 'number',
      label: label('新消息显示时长', 'New message preview duration'),
      defaultValue: 5,
      min: 1,
      max: 30,
      step: 1,
    },
    ...(
      [
        ['floatingOpacity', '消息不透明度', 'Message opacity'],
        ['floatingBubbleOpacity', '消息气泡不透明度', 'Message bubble opacity'],
        ['floatingInputOpacity', '输入区背景不透明度', 'Input background opacity'],
        ['floatingFontSize', '聊天字号', 'Chat font size'],
        ['floatingLineHeight', '聊天行距', 'Chat line spacing'],
      ] as const
    ).map(([key, zh, en]): FoliumParam => ({
      key,
      type: 'number',
      label: label(zh, en),
      group: floatingGroup,
      defaultValue: floatingChatDefaults[key],
      ...floatingChatRanges[key],
    })),
    {
      key: 'danmakuMode',
      type: 'select',
      label: label('显示模式', 'Display mode'),
      group: danmakuGroup,
      defaultValue: danmakuDefaults.danmakuMode,
      options: [
        { value: 'scroll', label: label('滚动', 'Scrolling') },
        { value: 'top', label: label('顶部', 'Top') },
        { value: 'bottom', label: label('底部', 'Bottom') },
      ],
    },
    ...(
      [
        ['danmakuArea', '显示区域', 'Display area'],
        ['danmakuOpacity', '不透明度', 'Opacity'],
        ['danmakuBackgroundOpacity', '弹幕背景不透明度', 'Danmaku background opacity'],
        ['danmakuHoverOpacity', '悬停背景不透明度', 'Hover background opacity'],
        ['danmakuFontSize', '字号', 'Font size'],
        ['danmakuSpeed', '速度', 'Speed'],
      ] as const
    ).map(([key, zh, en]): FoliumParam => ({
      key,
      type: 'number',
      label: label(zh, en),
      group: danmakuGroup,
      defaultValue: danmakuDefaults[key],
      ...danmakuRanges[key],
    })),
    {
      key: 'danmakuFont',
      type: 'select',
      label: label('字体', 'Font'),
      group: danmakuGroup,
      defaultValue: danmakuDefaults.danmakuFont,
      options: [
        { value: 'system', label: label('系统默认', 'System default') },
        { value: 'heiti', label: label('黑体', 'Sans serif') },
        { value: 'songti', label: label('宋体', 'Serif') },
      ],
    },
    {
      key: 'danmakuTextStyle',
      type: 'select',
      label: label('文字效果', 'Text effect'),
      group: danmakuGroup,
      defaultValue: danmakuDefaults.danmakuTextStyle,
      options: [
        { value: 'shadow', label: label('阴影', 'Shadow') },
        { value: 'stroke', label: label('描边', 'Outline') },
        { value: 'none', label: label('无', 'None') },
      ],
    },
    ...(
      [
        ['danmakuBold', '粗体', 'Bold'],
        ['danmakuText', '文字消息', 'Text messages'],
        ['danmakuMedia', '图片与表情', 'Images and stickers'],
        ['danmakuActivity', '房间动态', 'Room activity'],
        ['danmakuOverlap', '允许弹幕重叠', 'Allow overlapping comments'],
        ['danmakuDedupe', '合并重复弹幕', 'Merge repeated comments'],
      ] as const
    ).map(([key, zh, en]): FoliumParam => ({
      key,
      type: 'boolean',
      label: label(zh, en),
      group: danmakuGroup,
      defaultValue: danmakuDefaults[key],
    })),
  ],
}
function validate(field: FoliumParam, value: unknown) {
  if (field.type === 'boolean') return typeof value === 'boolean' ? value : undefined
  if (field.type === 'select')
    return typeof value === 'string' && field.options?.some((option) => option.value === value)
      ? value
      : undefined
  if (field.type === 'number' && typeof value === 'number' && Number.isFinite(value))
    return Math.max(field.min!, Math.min(field.max!, Math.round(value)))
  return undefined
}
function normalize(values: Readonly<Record<string, unknown>>): ChatPreferenceValues {
  return Object.freeze(
    Object.fromEntries(
      section.settings.map((field) => [
        field.key,
        validate(field, values[field.key]) ?? field.defaultValue,
      ]),
    ) as ChatPreferenceValues,
  )
}

// Keep the enable switch and the chat window's location/duration as the user chose them.
export function resetDanmakuPreferences(preferences: ChatPreferences) {
  preferences.set(danmakuDefaults)
}

// Reset appearance without moving an open conversation to another surface.
export function resetChatDisplayPreferences(preferences: ChatPreferences) {
  preferences.set({ ...floatingChatDefaults, peekSeconds: 5 })
}

export function createChatPreferences(folium: Folium): ChatPreferences {
  const handle = folium.registries.settingsSections.register(section),
    listeners = new Set<() => void>(),
    fields = section.settings.map((field) => field.key as keyof ChatPreferenceValues)
  let values = normalize(handle.params.get()),
    disposed = false
  const sync = () => {
    if (disposed) return
    const next = normalize(handle.params.get())
    if (fields.every((key) => next[key] === values[key])) return
    values = next
    for (const listener of [...listeners]) listener()
  }
  const unsubscribe = handle.params.subscribe(sync)
  return {
    get: () => values,
    set(patch) {
      if (disposed) return
      const update: Record<string, unknown> = {}
      for (const field of section.settings) {
        const key = field.key as keyof ChatPreferenceValues,
          next = validate(field, patch[key])
        if (next !== undefined && next !== values[key]) update[key] = next
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
