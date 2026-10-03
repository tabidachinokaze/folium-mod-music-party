import { describe, expect, it, vi } from 'vitest'
import { createChatPreferences } from '../src/client/chat-preferences'
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
    expect(preferences.get()).toEqual({ position: 'panel', danmaku: false, peekSeconds: 5 })
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
    expect(view.set).not.toHaveBeenCalled()
    preferences.dispose()
  })

  it('reads existing host values and writes back only changed settings', () => {
    const view = host({ position: 'bottom-left', danmaku: true, peekSeconds: 12 }),
      preferences = createChatPreferences(view.folium),
      changed = vi.fn()
    preferences.subscribe(changed)
    expect(preferences.get()).toEqual({ position: 'bottom-left', danmaku: true, peekSeconds: 12 })
    preferences.set({ position: 'panel', peekSeconds: 8 })
    expect(view.set).toHaveBeenLastCalledWith({ position: 'panel', peekSeconds: 8 })
    expect(changed).toHaveBeenCalledTimes(1)
    preferences.set({ position: 'panel', peekSeconds: 8 })
    expect(view.set).toHaveBeenCalledTimes(1)
    expect(preferences.get().danmaku).toBe(true)
    preferences.dispose()
    const remounted = createChatPreferences(view.folium)
    expect(remounted.get()).toEqual({ position: 'panel', danmaku: true, peekSeconds: 8 })
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
    expect(preferences.get()).toEqual({ position: 'panel', danmaku: false, peekSeconds: 5 })
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
})
