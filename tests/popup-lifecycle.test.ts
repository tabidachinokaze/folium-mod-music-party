import { afterEach, expect, it, vi } from 'vitest'
import { mountPopup } from '../src/client/popup-position'

// tests/popup-lifecycle.test.ts
// Simulate a details-backed popover whose reopening layout is not ready yet.
// A same-size reopen need not produce a new ResizeObserver notification.
function environment(floating = false) {
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 0,
    open = false,
    connected = true,
    height = 330
  const listeners = { addEventListener: vi.fn(), removeEventListener: vi.fn() }
  const doc = { ...listeners, querySelectorAll: vi.fn(() => [nativePanel]) }
  vi.stubGlobal('window', { ...listeners, innerWidth: 1100, innerHeight: 1020 })
  class Shadow {
    addEventListener = listeners.addEventListener
    removeEventListener = listeners.removeEventListener
    constructor(public host: HTMLElement) {}
  }
  vi.stubGlobal('ShadowRoot', Shadow)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'MutationObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const nativePanel = {
    getBoundingClientRect: () => ({ left: 740, right: 1060, top: 700, bottom: 988, height: 288 }),
  }
  const floatingChat = {
    parentElement: null,
    hidden: false,
    closest: (selector: string) => (selector === '.mp-floating-chat' ? floatingChat : null),
    matches: (selector: string) => selector === '.mp-floating-chat',
    getRootNode: () => doc,
    getBoundingClientRect: () => ({ left: 380, right: 700, top: 700, bottom: 1000, height: 300 }),
  } as unknown as HTMLElement
  const root = floating ? new Shadow(floatingChat) : doc
  vi.stubGlobal('getComputedStyle', (node: unknown) => ({
    maxHeight: node === nativePanel ? '932px' : '300px',
  }))
  const anchor = {
    ...listeners,
    ownerDocument: doc,
    parentElement: null,
    hidden: false,
    get isConnected() {
      return connected
    },
    closest: () => null,
    getRootNode: () => root,
    focus: vi.fn(),
    setAttribute: vi.fn(),
    getBoundingClientRect: () => ({ left: 860, right: 900, top: 970, bottom: 998 }),
  } as unknown as HTMLElement
  const style = { width: '', left: '', top: '', maxHeight: '', removeProperty: vi.fn() }
  const element = {
    classList: { add: vi.fn() },
    style,
    matches: () => open,
    isConnected: true,
    showPopover: () => {
      open = true
    },
    hidePopover: () => {
      open = false
    },
    getBoundingClientRect: () => ({ height }),
  } as unknown as HTMLElement
  const popup = mountPopup(element, anchor, floating ? { maxHeight: 'viewport' } : {})
  return {
    popup,
    style,
    keydown(event: Partial<KeyboardEvent>) {
      const handler = listeners.addEventListener.mock.calls.find(
        ([name]) => name === 'keydown',
      )?.[1]
      handler?.(event)
    },
    detach() {
      connected = false
    },
    get open() {
      return open
    },
    setHeight(value: number) {
      height = value
    },
    frame() {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach((callback) => callback(0))
    },
    get pendingFrames() {
      return frames.size
    },
  }
}
afterEach(() => vi.unstubAllGlobals())

it('rechecks a reopened popup after layout settles even without a resize notification', () => {
  const view = environment()
  view.popup.open()
  view.frame()
  view.popup.close()
  view.setHeight(0)
  view.popup.open()
  expect(Number.parseFloat(view.style.top)).toBe(958)
  view.setHeight(330)
  view.frame()
  expect(Number.parseFloat(view.style.top) + 330).toBeLessThanOrEqual(1012)
  expect(view.style.top).toBe('628px')
  view.popup.dispose()
})

it('cancels a pending placement when closed and schedules fresh geometry when reopened', () => {
  const view = environment()
  view.popup.open()
  expect(view.pendingFrames).toBe(1)
  view.popup.close()
  expect(view.pendingFrames).toBe(0)
  view.setHeight(180)
  view.popup.open()
  expect(view.pendingFrames).toBe(1)
  view.frame()
  expect(view.style.top).toBe('778px')
  view.popup.dispose()
  expect(view.pendingFrames).toBe(0)
})

it('closes a popup when its message anchor was removed before the next layout check', () => {
  const view = environment()
  view.popup.open()
  expect(view.open).toBe(true)
  view.detach()
  view.frame()
  expect(view.open).toBe(false)
  expect(view.pendingFrames).toBe(0)
  view.popup.dispose()
})

it('finds floating-chat bounds across a shadow host while keeping native player height', () => {
  const view = environment(true)
  view.popup.open()
  view.frame()
  expect(view.style.left).toBe('712px')
  expect(view.style.maxHeight).toBe('932px')
  expect(Number.parseFloat(view.style.top) + 330).toBeLessThanOrEqual(988)
  view.popup.dispose()
})

it('consumes Escape only while a popup is open, leaving the host navigation for a later Escape', () => {
  const view = environment(),
    event = { key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() }
  view.popup.open()
  view.keydown(event)
  expect(view.open).toBe(false)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(event.stopPropagation).toHaveBeenCalledOnce()
  view.keydown(event)
  expect(event.stopPropagation).toHaveBeenCalledOnce()
  view.popup.dispose()
})
