import { describe, expect, it, vi } from 'vitest'
import {
  createChatPreferences,
  danmakuDefaults,
  floatingChatDefaults,
  resetChatDisplayPreferences,
  resetDanmakuPreferences,
} from '../src/client/chat-preferences'
import type { Folium } from '../src/client/host'
import type { FoliumSettingsSectionDef } from '../vendor/folium/contract'

// tests/chat-preferences.test.ts
function host(initial: Record<string, unknown> = {}) {
  const stored = { ...initial },
    listeners = new Set<() => void>()
  let definition: FoliumSettingsSectionDef
  const unregister = vi.fn(),
    set = vi.fn((patch: Record<string, unknown>) => {
      Object.assign(stored, patch)
      for (const listener of [...listeners]) listener()
    }),
    register = vi.fn((section: FoliumSettingsSectionDef) => {
      definition = section
      return {
        id: `music-party:${section.id}`,
        unregister,
        params: {
          schema: section.settings,
          get: () => ({
            ...Object.fromEntries(section.settings.map((field) => [field.key, field.defaultValue])),
            ...stored,
          }),
          set,
          reset: () => {},
          subscribe: (listener: () => void) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        },
      }
    })
  const folium = { registries: { settingsSections: { register } } } as unknown as Folium
  return { folium, set, stored, register, unregister, listeners, definition: () => definition }
}

describe('chat preferences through native settings parameters', () => {
  it('registers the supported positions and bounded duration with the requested defaults', () => {
    const view = host(),
      preferences = createChatPreferences(view.folium)
    expect(preferences.get()).toEqual({
      position: 'panel',
      danmaku: false,
      peekSeconds: 5,
      ...danmakuDefaults,
      ...floatingChatDefaults,
    })
    expect(view.definition().id).toBe('chat')
    const fields = view.definition().settings
    expect(
      fields.find((field) => field.key === 'position')?.options?.map((option) => option.value),
    ).toEqual(['panel', 'bottom-left'])
    expect(fields.find((field) => field.key === 'peekSeconds')).toMatchObject({
      type: 'number',
      min: 1,
      max: 30,
      step: 1,
      defaultValue: 5,
    })
    expect(fields.find((field) => field.key === 'floatingBubbleOpacity')).toMatchObject({
      type: 'number',
      label: { 'zh-CN': '消息气泡不透明度', en: 'Message bubble opacity' },
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 35,
    })
    expect(fields.find((field) => field.key === 'danmakuHoverOpacity')).toMatchObject({
      type: 'number',
      label: { 'zh-CN': '悬停背景不透明度', en: 'Hover background opacity' },
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 35,
    })
    expect(fields.find((field) => field.key === 'danmakuBackgroundOpacity')).toMatchObject({
      type: 'number',
      label: { 'zh-CN': '弹幕背景不透明度', en: 'Danmaku background opacity' },
      min: 0,
      max: 100,
      step: 1,
      defaultValue: 12,
    })
    expect(view.set).not.toHaveBeenCalled()
    preferences.dispose()
  })

  it('reads existing host values and writes back only changed settings', () => {
    const view = host({ position: 'bottom-left', danmaku: true, peekSeconds: 12 }),
      preferences = createChatPreferences(view.folium),
      changed = vi.fn()
    preferences.subscribe(changed)
    expect(preferences.get()).toEqual({
      position: 'bottom-left',
      danmaku: true,
      peekSeconds: 12,
      ...danmakuDefaults,
      ...floatingChatDefaults,
    })
    preferences.set({ position: 'panel', peekSeconds: 8 })
    expect(view.set).toHaveBeenLastCalledWith({ position: 'panel', peekSeconds: 8 })
    expect(changed).toHaveBeenCalledTimes(1)
    preferences.set({ position: 'panel', peekSeconds: 8 })
    expect(view.set).toHaveBeenCalledTimes(1)
    expect(preferences.get().danmaku).toBe(true)
    preferences.dispose()
    const remounted = createChatPreferences(view.folium)
    expect(remounted.get()).toEqual({
      position: 'panel',
      danmaku: true,
      peekSeconds: 8,
      ...danmakuDefaults,
      ...floatingChatDefaults,
    })
    remounted.dispose()
  })

  it('reacts to edits in the native mod settings without duplicate notifications', () => {
    const view = host(),
      preferences = createChatPreferences(view.folium),
      changed = vi.fn(),
      stop = preferences.subscribe(changed)
    const previous = preferences.get()
    view.set({ danmaku: true })
    expect(preferences.get()).not.toBe(previous)
    expect(preferences.get().danmaku).toBe(true)
    expect(changed).toHaveBeenCalledTimes(1)
    view.set({ danmaku: true, unknown: 'ignored' })
    expect(changed).toHaveBeenCalledTimes(1)
    stop()
    view.set({ position: 'bottom-left' })
    expect(changed).toHaveBeenCalledTimes(1)
    expect(preferences.get().position).toBe('bottom-left')
    preferences.dispose()
  })

  it('clamps duration, ignores invalid patches and never persists unrelated data', () => {
    const view = host({ position: 'elsewhere', danmaku: 'yes', peekSeconds: Infinity }),
      preferences = createChatPreferences(view.folium)
    expect(preferences.get()).toEqual({
      position: 'panel',
      danmaku: false,
      peekSeconds: 5,
      ...danmakuDefaults,
      ...floatingChatDefaults,
    })
    preferences.set({ peekSeconds: -20 })
    expect(preferences.get().peekSeconds).toBe(1)
    preferences.set({ peekSeconds: 99 })
    expect(preferences.get().peekSeconds).toBe(30)
    preferences.set({ peekSeconds: 7.6 })
    expect(preferences.get().peekSeconds).toBe(8)
    view.set.mockClear()
    preferences.set({
      position: 'sideways',
      danmaku: 'yes',
      peekSeconds: NaN,
      cookie: 'never-store',
    } as never)
    expect(view.set).not.toHaveBeenCalled()
    expect(view.stored).not.toHaveProperty('cookie')
    preferences.dispose()
  })

  it('unregisters once and removes listeners when disposed', () => {
    const view = host(),
      preferences = createChatPreferences(view.folium),
      changed = vi.fn()
    preferences.subscribe(changed)
    preferences.dispose()
    preferences.dispose()
    expect(view.unregister).toHaveBeenCalledTimes(1)
    expect(view.listeners.size).toBe(0)
    preferences.set({ danmaku: true })
    expect(view.set).not.toHaveBeenCalled()
    view.set({ danmaku: true })
    expect(changed).not.toHaveBeenCalled()
    expect(preferences.get().danmaku).toBe(false)
  })

  it('persists all supported modes, styles and real message filters', () => {
    const view = host(),
      preferences = createChatPreferences(view.folium),
      changed = vi.fn()
    preferences.subscribe(changed)
    const choices = {
      danmakuMode: 'bottom' as const,
      danmakuArea: 100,
      danmakuOpacity: 50,
      danmakuBackgroundOpacity: 0,
      danmakuHoverOpacity: 0,
      danmakuFontSize: 125,
      danmakuSpeed: 75,
      danmakuFont: 'songti' as const,
      danmakuBold: false,
      danmakuTextStyle: 'stroke' as const,
      danmakuText: false,
      danmakuActivity: false,
      danmakuMedia: false,
      danmakuOverlap: true,
      danmakuDedupe: false,
    }
    preferences.set(choices)
    expect(view.set).toHaveBeenLastCalledWith(choices)
    expect(preferences.get()).toMatchObject(choices)
    expect(changed).toHaveBeenCalledTimes(1)
    preferences.dispose()
    const remounted = createChatPreferences(view.folium)
    expect(remounted.get()).toMatchObject(choices)
    remounted.dispose()
  })

  it.each([
    ['danmakuArea', 10, 100],
    ['danmakuOpacity', 10, 100],
    ['danmakuBackgroundOpacity', 0, 100],
    ['danmakuHoverOpacity', 0, 100],
    ['danmakuFontSize', 75, 150],
    ['danmakuSpeed', 50, 150],
    ['floatingOpacity', 20, 100],
    ['floatingBubbleOpacity', 0, 100],
    ['floatingInputOpacity', 0, 100],
    ['floatingFontSize', 75, 150],
    ['floatingLineHeight', 100, 160],
  ] as const)('bounds %s at both write and native-store read boundaries', (key, min, max) => {
    const view = host({ [key]: max + 100 }),
      preferences = createChatPreferences(view.folium)
    expect(preferences.get()[key]).toBe(max)
    preferences.set({ [key]: -100 })
    expect(preferences.get()[key]).toBe(min)
    preferences.set({ [key]: max + 100 })
    expect(preferences.get()[key]).toBe(max)
    preferences.set({ [key]: min + 2.7 })
    expect(preferences.get()[key]).toBe(min + 3)
    view.set.mockClear()
    preferences.set({ [key]: Infinity })
    expect(view.set).not.toHaveBeenCalled()
    preferences.dispose()
  })

  it('rejects unsupported fonts/modes and invalid toggle types rather than persisting them', () => {
    const view = host({
        danmakuMode: 'advanced-bas',
        danmakuFont: 'remote-url',
        danmakuTextStyle: 'glow',
      }),
      preferences = createChatPreferences(view.folium)
    expect(preferences.get()).toMatchObject(danmakuDefaults)
    preferences.set({
      danmakuMode: 'invalid',
      danmakuFont: 'invalid',
      danmakuTextStyle: 'invalid',
      danmakuBold: 'true',
      danmakuText: 'false',
      danmakuMedia: 0,
      danmakuActivity: null,
      danmakuOverlap: 'yes',
      danmakuDedupe: 1,
    } as never)
    expect(view.set).not.toHaveBeenCalled()
    preferences.dispose()
  })

  it('persists floating appearance independently and resets it without moving chat or changing danmaku', () => {
    const view = host({
        position: 'bottom-left',
        peekSeconds: 17,
        danmaku: true,
        danmakuOpacity: 35,
        danmakuBackgroundOpacity: 64,
        danmakuHoverOpacity: 75,
      }),
      preferences = createChatPreferences(view.folium),
      appearance = {
        floatingOpacity: 70,
        floatingBubbleOpacity: 0,
        floatingInputOpacity: 0,
        floatingFontSize: 140,
        floatingLineHeight: 130,
      }
    preferences.set(appearance)
    expect(view.set).toHaveBeenLastCalledWith(appearance)
    preferences.dispose()
    const remounted = createChatPreferences(view.folium)
    expect(remounted.get()).toMatchObject(appearance)
    expect(remounted.get().floatingBubbleOpacity).toBe(0)
    resetChatDisplayPreferences(remounted)
    expect(remounted.get()).toMatchObject({
      ...floatingChatDefaults,
      peekSeconds: 5,
      position: 'bottom-left',
      danmaku: true,
      danmakuOpacity: 35,
      danmakuBackgroundOpacity: 64,
      danmakuHoverOpacity: 75,
    })
    expect(remounted.get().floatingBubbleOpacity).toBe(35)
    expect(view.set.mock.lastCall![0]).not.toHaveProperty('position')
    expect(view.set.mock.lastCall![0]).not.toHaveProperty('danmaku')
    const count = view.set.mock.calls.length
    resetChatDisplayPreferences(remounted)
    expect(view.set).toHaveBeenCalledTimes(count)
    remounted.dispose()
  })

  it('restores danmaku options without disabling it or resetting chat position and timing', () => {
    const view = host({
        position: 'bottom-left',
        peekSeconds: 23,
        floatingOpacity: 60,
        floatingBubbleOpacity: 80,
        danmaku: true,
        danmakuMode: 'top',
        danmakuFont: 'heiti',
        danmakuOpacity: 25,
        danmakuBackgroundOpacity: 0,
        danmakuHoverOpacity: 0,
        danmakuText: false,
        danmakuOverlap: true,
      }),
      preferences = createChatPreferences(view.folium),
      changed = vi.fn()
    preferences.subscribe(changed)
    resetDanmakuPreferences(preferences)
    expect(preferences.get()).toEqual({
      ...danmakuDefaults,
      ...floatingChatDefaults,
      position: 'bottom-left',
      peekSeconds: 23,
      floatingOpacity: 60,
      floatingBubbleOpacity: 80,
      danmaku: true,
    })
    const patch = view.set.mock.calls[0][0]
    expect(patch.danmakuBackgroundOpacity).toBe(12)
    expect(patch.danmakuHoverOpacity).toBe(35)
    expect(patch).not.toHaveProperty('position')
    expect(patch).not.toHaveProperty('peekSeconds')
    expect(patch).not.toHaveProperty('danmaku')
    expect(changed).toHaveBeenCalledTimes(1)
    resetDanmakuPreferences(preferences)
    expect(changed).toHaveBeenCalledTimes(1)
    preferences.dispose()
  })
})
