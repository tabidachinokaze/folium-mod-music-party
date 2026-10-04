import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  PRIVATE_PRESENCE_TTL,
  PRIVATE_PRESENCE_ROUND_LIMIT,
  PrivatePresence,
} from '../src/client/private-presence'
import { AccountConnection } from '../src/client/host'
import type { PartyController } from '../src/client/controller'
import type { PrivatePeer } from '../src/shared/private-notices'
import { fakeHost } from './fixtures'

// tests/private-presence.test.ts
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const peer = (uid: string, online: boolean | null = true): PrivatePeer => ({
  uid,
  nickname: 'Peer',
  avatar: '',
  online,
})
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function setup() {
  const listeners = new Set<() => void>()
  const read = vi.fn(async (uid: string) => peer(uid))
  const controller = {
    state: { account: { uid: '1' } as { uid: string } | null },
    connection: { privatePeer: read },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    handleAccountError: vi.fn(),
  }
  const doc = new EventTarget(),
    win = new EventTarget()
  let foreground = true
  const service = new PrivatePresence(controller as unknown as PartyController, {
    document: doc,
    window: win,
    foreground: () => foreground,
  })
  return {
    service,
    controller,
    read,
    doc,
    win,
    foreground(value: boolean) {
      foreground = value
    },
    account(uid: string | null) {
      controller.state.account = uid ? { uid } : null
      for (const listener of listeners) listener()
    },
    listeners,
  }
}

it('merges visible viewers, limits concurrency to two and reuses cached peers for 45 seconds', async () => {
  const x = setup(),
    a = deferred<PrivatePeer>(),
    b = deferred<PrivatePeer>()
  x.read.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
  const first = x.service.watch({
    peers: () => ['2', '3', '4'],
    active: () => true,
    changed: vi.fn(),
  })
  const second = x.service.watch({ peers: () => ['2'], active: () => true, changed: vi.fn() })
  await vi.advanceTimersByTimeAsync(0)
  expect(x.read.mock.calls.map(([uid]) => uid)).toEqual(['2', '3'])
  first.refresh()
  second.refresh()
  await vi.advanceTimersByTimeAsync(0)
  expect(x.read).toHaveBeenCalledTimes(2)
  a.resolve(peer('2'))
  b.resolve(peer('3', false))
  await vi.advanceTimersByTimeAsync(1)
  expect(x.read.mock.calls.map(([uid]) => uid)).toEqual(['2', '3', '4'])
  expect(x.service.get('2')?.online).toBe(true)
  expect(x.service.get('3')?.online).toBe(false)
  await vi.advanceTimersByTimeAsync(PRIVATE_PRESENCE_TTL - 2)
  expect(x.read).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(2)
  expect(x.read).toHaveBeenCalledTimes(6)
  first.dispose()
  second.dispose()
  expect(x.listeners.size).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
})

it('does not poll unfocused or hidden contacts and refreshes newly visible peers without a request storm', async () => {
  const x = setup()
  let active = true,
    visible = ['2']
  const watch = x.service.watch({ peers: () => visible, active: () => active, changed: vi.fn() })
  await vi.advanceTimersByTimeAsync(0)
  x.foreground(false)
  x.win.dispatchEvent(new Event('blur'))
  await vi.advanceTimersByTimeAsync(PRIVATE_PRESENCE_TTL * 3)
  expect(x.read).toHaveBeenCalledTimes(1)
  x.foreground(true)
  active = false
  x.win.dispatchEvent(new Event('focus'))
  await vi.advanceTimersByTimeAsync(0)
  expect(x.read).toHaveBeenCalledTimes(1)
  active = true
  visible = ['3']
  for (let count = 0; count < 20; count++) watch.refresh()
  await vi.advanceTimersByTimeAsync(0)
  expect(x.read.mock.calls.map(([uid]) => uid)).toEqual(['2', '3'])
  watch.dispose()
})

it('clears account-scoped data and rejects stale results across logout/login with the same UID', async () => {
  const x = setup(),
    old = deferred<PrivatePeer>(),
    newer = deferred<PrivatePeer>()
  x.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(newer.promise)
  const changed = vi.fn()
  const watch = x.service.watch({ peers: () => ['2'], active: () => true, changed })
  await vi.advanceTimersByTimeAsync(0)
  x.account(null)
  x.account('1')
  await vi.advanceTimersByTimeAsync(0)
  changed.mockClear()
  old.resolve(peer('2'))
  await vi.advanceTimersByTimeAsync(0)
  expect(x.service.get('2')).toBeUndefined()
  expect(changed).not.toHaveBeenCalled()
  newer.resolve(peer('2', false))
  await vi.advanceTimersByTimeAsync(0)
  expect(x.service.get('2')?.online).toBe(false)
  x.account('5')
  expect(x.service.get('2')).toBeUndefined()
  watch.dispose()
})

it('treats missing status and failed refresh as unknown and retains metadata without claiming online', async () => {
  const x = setup()
  const watch = x.service.watch({ peers: () => ['2'], active: () => true, changed: vi.fn() })
  await vi.advanceTimersByTimeAsync(0)
  expect(x.service.get('2')?.online).toBe(true)
  x.read.mockRejectedValueOnce(new Error('temporarily offline'))
  await vi.advanceTimersByTimeAsync(PRIVATE_PRESENCE_TTL)
  expect(x.service.get('2')).toEqual(peer('2', null))
  x.read.mockResolvedValueOnce({ uid: '2', nickname: 'Peer', avatar: '' } as PrivatePeer)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(x.service.get('2')?.online).toBeNull()
  watch.dispose()
})

it('stops timers and ignores pending metadata after the last view is disposed', async () => {
  const x = setup(),
    pending = deferred<PrivatePeer>(),
    changed = vi.fn()
  x.read.mockReturnValueOnce(pending.promise)
  const watch = x.service.watch({ peers: () => ['2'], active: () => true, changed })
  await vi.advanceTimersByTimeAsync(0)
  watch.dispose()
  changed.mockClear()
  pending.resolve(peer('2'))
  await vi.advanceTimersByTimeAsync(PRIVATE_PRESENCE_TTL * 2)
  expect(changed).not.toHaveBeenCalled()
  expect(x.service.get('2')).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
  expect(x.listeners.size).toBe(0)
})

it('guards peer RPC results against account changes and never performs account/history/read calls', async () => {
  const host = fakeHost()
  let cookie = 'MUSIC_U=first'
  const rpc = vi.fn(async (name: string) =>
    name === 'call' ? { ok: true, data: { data: { profile: { userId: 1 } } } } : peer('2'),
  )
  host.folium.rpc.call = rpc as any
  const connection = new AccountConnection(
    host.folium,
    () => cookie,
    async () => 30000,
  )
  await connection.connect()
  rpc.mockClear()
  await expect(connection.privatePeer('2')).resolves.toEqual(peer('2'))
  expect(rpc).toHaveBeenCalledExactlyOnceWith('privatePeer', '2')
  const pending = deferred<any>()
  rpc.mockReturnValueOnce(pending.promise)
  const result = connection.privatePeer('2')
  cookie = 'MUSIC_U=second'
  pending.resolve(peer('2'))
  await expect(result).rejects.toMatchObject({ code: 302 })
  rpc.mockClear()
  await expect(connection.privatePeer('2')).rejects.toMatchObject({ code: 302 })
  expect(rpc).not.toHaveBeenCalled()
  connection.close()
})

it('gradually queries loaded offscreen peers without stopping after the first 128', async () => {
  const x = setup()
  const loaded = Array.from({ length: 160 }, (_, index) => String(index + 2))
  const watch = x.service.watch({ peers: () => loaded, active: () => true, changed: vi.fn() })
  await vi.advanceTimersByTimeAsync(1000)
  expect(x.read.mock.calls.map(([uid]) => uid)).toEqual(loaded)
  expect(x.service.get(loaded.at(-1)!)?.online).toBe(true)
  watch.refresh()
  await vi.advanceTimersByTimeAsync(1000)
  expect(x.read).toHaveBeenCalledTimes(loaded.length)
  watch.dispose()
})

it('bounds requests beyond the cache size and rotates into the remaining loaded contacts', async () => {
  const x = setup()
  const loaded = Array.from({ length: 320 }, (_, index) => String(index + 2))
  const watch = x.service.watch({ peers: () => loaded, active: () => true, changed: vi.fn() })
  await vi.advanceTimersByTimeAsync(1000)
  expect(x.read).toHaveBeenCalledTimes(PRIVATE_PRESENCE_ROUND_LIMIT)
  for (let i = 0; i < 10; i++) watch.refresh()
  await vi.advanceTimersByTimeAsync(PRIVATE_PRESENCE_TTL - 1001)
  expect(x.read).toHaveBeenCalledTimes(PRIVATE_PRESENCE_ROUND_LIMIT)
  await vi.advanceTimersByTimeAsync(1001)
  expect(x.read.mock.calls[PRIVATE_PRESENCE_ROUND_LIMIT][0]).toBe(
    loaded[PRIVATE_PRESENCE_ROUND_LIMIT],
  )
  expect(new Set(x.read.mock.calls.map(([uid]) => uid)).size).toBe(loaded.length)
  expect(x.read.mock.calls.length).toBeLessThanOrEqual(PRIVATE_PRESENCE_ROUND_LIMIT * 2)
  watch.dispose()
  expect(vi.getTimerCount()).toBe(0)
})
