import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PrivateNotifications } from '../src/client/private-notifications'
import { AccountConnection } from '../src/client/host'
import { PartyController } from '../src/client/controller'
import type { PrivateNotice, PrivateNotificationBatch } from '../src/shared/private-notices'
import { fakeHost } from './fixtures'

// tests/private-notifications.test.ts
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const notice = (id = 'm1'): PrivateNotice => ({
  kind: 'message',
  id,
  peerUid: '2',
  senderUid: '2',
  messageId: id,
  timestamp: 123,
  messageType: 1,
  text: 'New message',
  self: false,
})
const batch = (patch: Partial<PrivateNotificationBatch> = {}): PrivateNotificationBatch => ({
  session: 'session-a',
  cursor: 1,
  connected: true,
  reset: false,
  events: [{ sequence: 1, notice: notice() }],
  ...patch,
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
  const transport = { privateNotificationsPoll: vi.fn(async () => batch()) },
    onError = vi.fn(),
    receive = vi.fn(),
    service = new PrivateNotifications(transport, onError)
  service.subscribe(receive)
  return { service, transport, onError, receive }
}

describe('account-wide private notifications', () => {
  it('reads the local feed without a mounted page or focus, deduplicates replay, and stops on logout', async () => {
    const x = setup()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(x.transport.privateNotificationsPoll).not.toHaveBeenCalled()
    x.service.setAccount('1')
    await vi.advanceTimersByTimeAsync(0)
    expect(x.transport.privateNotificationsPoll).toHaveBeenLastCalledWith(0, '')
    expect(x.receive.mock.calls.map(([event]) => event.kind)).toEqual(['sync', 'message'])
    expect(x.receive).toHaveBeenLastCalledWith(notice())
    await vi.advanceTimersByTimeAsync(2000)
    expect(x.transport.privateNotificationsPoll).toHaveBeenLastCalledWith(1, 'session-a')
    expect(x.receive).toHaveBeenCalledTimes(2)
    // Replayed business IDs with a later sequence are still one event.
    x.transport.privateNotificationsPoll.mockResolvedValue(
      batch({ cursor: 2, events: [{ sequence: 2, notice: notice() }] }),
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(x.receive).toHaveBeenCalledTimes(2)
    x.service.setAccount(null)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(x.transport.privateNotificationsPoll).toHaveBeenCalledTimes(4)
    x.service.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores a previous account response even across logout and login of the same UID', async () => {
    const x = setup(),
      first = deferred<PrivateNotificationBatch>()
    x.transport.privateNotificationsPoll.mockReturnValueOnce(first.promise)
    x.service.setAccount('1')
    await vi.advanceTimersByTimeAsync(0)
    x.service.setAccount(null)
    x.service.setAccount('1')
    x.transport.privateNotificationsPoll.mockResolvedValue(
      batch({ session: 'session-b', cursor: 0, events: [] }),
    )
    await vi.advanceTimersByTimeAsync(0)
    x.receive.mockClear()
    first.resolve(batch())
    await vi.advanceTimersByTimeAsync(0)
    expect(x.receive).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(x.transport.privateNotificationsPoll).toHaveBeenLastCalledWith(0, 'session-b')
    expect(x.onError).not.toHaveBeenCalled()
    x.service.dispose()
  })

  it('handles retained-buffer gaps and main restarts without losing reconnect sync notices', async () => {
    const x = setup()
    x.service.setAccount('1')
    await vi.advanceTimersByTimeAsync(0)
    x.receive.mockClear()
    x.transport.privateNotificationsPoll.mockResolvedValue(
      batch({ reset: true, cursor: 40, events: [{ sequence: 40, notice: notice('m40') }] }),
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(x.receive.mock.calls.map(([event]) => event.kind)).toEqual(['sync', 'message'])
    x.receive.mockClear()
    x.transport.privateNotificationsPoll.mockResolvedValue(
      batch({
        session: 'session-b',
        cursor: 1,
        reset: true,
        events: [{ sequence: 1, notice: { kind: 'sync', id: 'reconnected', timestamp: 456 } }],
      }),
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(x.receive).toHaveBeenCalledExactlyOnceWith({
      kind: 'sync',
      id: 'reconnected',
      timestamp: 456,
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(x.transport.privateNotificationsPoll).toHaveBeenLastCalledWith(1, 'session-b')
    // An explicit cursor reset is authoritative even if the session ID stayed the same.
    x.transport.privateNotificationsPoll.mockResolvedValue(
      batch({ session: 'session-b', cursor: 0, reset: true, events: [] }),
    )
    await vi.advanceTimersByTimeAsync(2000)
    expect(x.transport.privateNotificationsPoll).toHaveBeenLastCalledWith(0, 'session-b')
    x.service.dispose()
  })

  it('backs off local transport failures, does not overlap reads, and ignores disposed auth failures', async () => {
    const x = setup(),
      first = deferred<PrivateNotificationBatch>()
    x.transport.privateNotificationsPoll.mockReturnValueOnce(first.promise)
    x.service.setAccount('1')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(x.transport.privateNotificationsPoll).toHaveBeenCalledOnce()
    first.reject(new Error('local RPC temporarily unavailable'))
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1999)
    expect(x.transport.privateNotificationsPoll).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(x.transport.privateNotificationsPoll).toHaveBeenCalledTimes(2)
    const late = deferred<PrivateNotificationBatch>()
    x.transport.privateNotificationsPoll.mockReturnValueOnce(late.promise)
    await vi.advanceTimersByTimeAsync(1000)
    x.service.dispose()
    late.reject({ code: 302 })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(x.onError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops on a current-account auth failure without emitting a toast or reading messages', async () => {
    const x = setup()
    x.transport.privateNotificationsPoll.mockRejectedValue({ code: 302 })
    x.service.setAccount('1')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(x.onError).toHaveBeenCalledExactlyOnceWith({ code: 302 })
    expect(x.transport.privateNotificationsPoll).toHaveBeenCalledOnce()
    expect(x.receive).not.toHaveBeenCalled()
    x.service.dispose()
  })

  it('keeps the controller receiver running after detaching a room and disposes with the controller', async () => {
    const host = fakeHost(),
      connection = {
        connect: vi.fn(async () => ({ uid: '1', nickname: 'Account' })),
        call: vi.fn(async () => ({ data: { multiLtRoomSnapshot: null } })),
        privateNotificationsPoll: vi.fn(async () => batch()),
        close: vi.fn(),
      }
    const controller = new PartyController(host.folium, connection as unknown as AccountConnection)
    const receive = vi.fn()
    controller.privateNotifications.subscribe(receive)
    await controller.connect()
    await vi.advanceTimersByTimeAsync(0)
    expect(receive).toHaveBeenLastCalledWith(notice())
    connection.call.mockClear()
    host.folium.ui.toast = vi.fn()
    controller.detach()
    await vi.advanceTimersByTimeAsync(1000)
    expect(connection.privateNotificationsPoll).toHaveBeenCalledTimes(2)
    expect(connection.call).not.toHaveBeenCalled()
    expect(host.folium.ui.toast).not.toHaveBeenCalled()
    controller.dispose()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(connection.privateNotificationsPoll).toHaveBeenCalledTimes(2)
    expect(connection.close).toHaveBeenCalledOnce()
  })

  it('disconnects main immediately when the controller loses its verified account', async () => {
    const host = fakeHost(),
      connection = {
        connect: vi.fn(async () => ({ uid: '1', nickname: 'Account' })),
        call: vi.fn(async () => ({ data: { multiLtRoomSnapshot: null } })),
        privateNotificationsPoll: vi.fn(async () => batch()),
        close: vi.fn(),
      }
    const controller = new PartyController(host.folium, connection as unknown as AccountConnection)
    await controller.connect()
    await vi.advanceTimersByTimeAsync(0)
    controller.handleAccountError({ code: 302 })
    expect(controller.state.account).toBeNull()
    expect(connection.close).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(connection.privateNotificationsPoll).toHaveBeenCalledOnce()
    controller.dispose()
  })
})

it('AccountConnection reads only the local RPC and rejects cookie switches before and after await', async () => {
  const host = fakeHost()
  let cookie = 'MUSIC_U=test-one'
  const rpc = vi.fn(async (name: string, ..._args: unknown[]) => {
    if (name === 'call') return { ok: true, data: { data: { profile: { userId: 1 } } } }
    if (name === 'privateNotificationsPoll') return batch()
  })
  host.folium.rpc.call = rpc as any
  const connection = new AccountConnection(
    host.folium,
    () => cookie,
    async () => 30000,
  )
  await connection.connect()
  rpc.mockClear()
  await expect(connection.privateNotificationsPoll(4, 'session-a')).resolves.toEqual(batch())
  expect(rpc).toHaveBeenCalledExactlyOnceWith('privateNotificationsPoll', 4, 'session-a')
  const late = deferred<any>()
  rpc.mockReturnValueOnce(late.promise)
  const pending = connection.privateNotificationsPoll(5, 'session-a')
  cookie = 'MUSIC_U=test-two'
  late.resolve(batch())
  await expect(pending).rejects.toMatchObject({ code: 302 })
  rpc.mockClear()
  await expect(connection.privateNotificationsPoll(5, 'session-a')).rejects.toMatchObject({
    code: 302,
  })
  expect(rpc).not.toHaveBeenCalled()
  connection.close()
})

it.each([
  null,
  {},
  { userId: 0 },
  { userId: -1 },
  { userId: '' },
  { userId: 'invalid' },
  { userId: Number.MAX_SAFE_INTEGER + 1 },
])(
  'treats a successful anonymous or invalid account response as expired authentication (%#)',
  async (profile) => {
    const host = fakeHost()
    host.folium.rpc.call = vi.fn(async (name: string) =>
      name === 'call' ? { ok: true, data: { code: 200, data: { profile } } } : undefined,
    ) as any
    const connection = new AccountConnection(
      host.folium,
      () => 'MUSIC_U=test',
      async () => 30000,
    )
    await expect(connection.connect()).rejects.toMatchObject({ code: 302 })
    connection.close()
  },
)

it('closes an existing background connection when an upload account check becomes anonymous', async () => {
  const host = fakeHost()
  let profile: { userId: number } | null = { userId: 1 }
  const rpc = vi.fn(async (name: string, request?: any) => {
    if (name === 'call')
      return {
        ok: true,
        data:
          request.method === 'account'
            ? { code: 200, data: { profile } }
            : { data: { multiLtRoomSnapshot: null } },
      }
    if (name === 'privateNotificationsPoll') return batch()
  })
  host.folium.rpc.call = rpc as any
  const connection = new AccountConnection(
    host.folium,
    () => 'MUSIC_U=test',
    async () => 30000,
  )
  const controller = new PartyController(host.folium, connection)
  await controller.connect()
  await vi.advanceTimersByTimeAsync(0)
  expect(controller.state.account?.uid).toBe('1')
  expect(rpc.mock.calls.filter(([name]) => name === 'privateNotificationsPoll')).toHaveLength(1)
  profile = null
  await controller.run(() => connection.attachment('media', {}))
  expect(controller.state.account).toBeNull()
  expect(rpc.mock.calls.filter(([name]) => name === 'disconnect')).toHaveLength(1)
  expect(rpc.mock.calls.some(([name]) => name === 'media')).toBe(false)
  await vi.advanceTimersByTimeAsync(30_000)
  expect(rpc.mock.calls.filter(([name]) => name === 'privateNotificationsPoll')).toHaveLength(1)
  controller.dispose()
})
