import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// tests/window-resume-startup.test.ts
const mocks = vi.hoisted(() => ({
  session: 'session-a',
  resume: null as null | ((state: unknown, expiresAt: number) => void),
  instances: [] as any[],
  connect: async (_controller: any) => {},
}))
vi.mock('../src/client/host', () => ({
  activeNeteaseSession: () => mocks.session,
  getPlaybackBridge: () => ({
    onWindowResume: (handler: typeof mocks.resume) => {
      mocks.resume = handler
      return () => {
        mocks.resume = null
      }
    },
  }),
}))
vi.mock('../src/client/controller', () => ({
  PartyController: class {
    state = { account: null as any }
    resumeWindow = vi.fn(async () => {})
    checkAvailableRoom = vi.fn(async () => {})
    dispose = vi.fn()
    connect = () => mocks.connect(this)
    constructor() {
      mocks.instances.push(this)
    }
  },
}))
vi.mock('../src/client/private-home', () => ({ mountPrivateHome: vi.fn() }))
vi.mock('../src/client/panel', () => ({ mountPanel: vi.fn() }))
vi.mock('../src/client/i18n', () => ({ setLocale: vi.fn(), t: (value: string) => value }))
vi.mock('../src/client/party-icon', () => ({ createPartyIcon: vi.fn(), partyIconPaths: [] }))
vi.mock('../src/client/chat-preferences', () => ({
  createChatPreferences: () => ({ dispose: vi.fn() }),
}))
vi.mock('../src/client/chat-presentation', () => ({
  createChatPresentation: () => ({ dispose: vi.fn() }),
}))
vi.mock('../src/client/private-bubbles', () => ({
  createPrivateBubbles: () => ({ dispose: vi.fn() }),
}))
import activate from '../src/client/index'
import type { Folium } from '../src/client/host'

let dispose: (() => void) | undefined
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
const start = () => {
  const registry = { register: vi.fn(() => ({ unregister: vi.fn() })) }
  dispose = activate({
    env: { context: 'main' },
    registries: {
      stageLayers: registry,
      homeTabs: registry,
      playerPanelTabs: registry,
      commands: registry,
      controlButtons: registry,
    },
  } as unknown as Folium)
}
beforeEach(() => {
  vi.useFakeTimers()
  mocks.session = 'session-a'
  mocks.resume = null
  mocks.instances = []
  mocks.connect = async (controller) => {
    controller.state.account = { uid: '9' }
  }
  vi.stubGlobal('document', { documentElement: { lang: 'zh-CN' } })
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setInterval, clearInterval }))
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('window resume during client startup', () => {
  it('does not auto-join on an ordinary launch and consumes a delivered continuation only once', async () => {
    start()
    await flush()
    const controller = mocks.instances[0]
    expect(controller.resumeWindow).not.toHaveBeenCalled()
    const ticket = { uid: '9', roomId: 'room' },
      expiresAt = Date.now() + 60000
    mocks.resume!(ticket, expiresAt)
    await flush()
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(1500)
    expect(controller.resumeWindow).toHaveBeenCalledExactlyOnceWith(ticket, expiresAt)
  })
  it('waits for a connecting account instead of dropping a valid handoff', async () => {
    let finish!: () => void
    mocks.connect = (controller) =>
      new Promise<void>((resolve) => {
        finish = () => {
          controller.state.account = { uid: '9' }
          resolve()
        }
      })
    start()
    const ticket = { uid: '9', roomId: 'room' },
      expiresAt = Date.now() + 60000
    mocks.resume!(ticket, expiresAt)
    expect(mocks.instances[0].resumeWindow).not.toHaveBeenCalled()
    finish()
    await flush()
    expect(mocks.instances[0].resumeWindow).toHaveBeenCalledExactlyOnceWith(ticket, expiresAt)
  })
  it('clears a pending handoff if the selected account changes before connection completes', async () => {
    let finish!: () => void
    mocks.connect = (controller) =>
      new Promise<void>((resolve) => {
        finish = () => {
          controller.state.account = { uid: '9' }
          resolve()
        }
      })
    start()
    mocks.resume!({ uid: '9', roomId: 'room' }, Date.now() + 60000)
    const old = mocks.instances[0],
      finishOld = finish
    mocks.session = 'session-b'
    window.dispatchEvent(new Event('storage'))
    finishOld()
    finish()
    await flush()
    expect(old.dispose).toHaveBeenCalledOnce()
    for (const controller of mocks.instances) expect(controller.resumeWindow).not.toHaveBeenCalled()
  })
  it('cancels pending continuation when the mod is disabled during account loading', async () => {
    let finish!: () => void
    mocks.connect = (controller) =>
      new Promise<void>((resolve) => {
        finish = () => {
          controller.state.account = { uid: '9' }
          resolve()
        }
      })
    start()
    mocks.resume!({ uid: '9', roomId: 'room' }, Date.now() + 60000)
    dispose!()
    dispose = undefined
    finish()
    await flush()
    expect(mocks.resume).toBeNull()
    expect(mocks.instances[0].resumeWindow).not.toHaveBeenCalled()
  })
})
