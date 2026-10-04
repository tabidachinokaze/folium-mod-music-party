import { gzipSync } from 'node:zlib'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SharedNotifications, type NotificationFactory } from '../src/main/shared-notifications'
import type { MiniNotice, MiniNotificationOptions } from '../src/main/mini-notifications'
import { PRIVATE_REALTIME_BIZ } from '../src/main/private-notice'

// tests/shared-notifications.test.ts
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
const credentials = { accId: 'test-im-account', token: 'test-im-token' }
function setup(getCredentials = vi.fn(async () => credentials)) {
  const sockets: {
    options: MiniNotificationOptions
    notices: MiniNotice[]
    open: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    poll: () => MiniNotice[]
  }[] = []
  const make: NotificationFactory = (options) => {
    let closed = false
    const socket = {
      options,
      notices: [] as MiniNotice[],
      open: vi.fn(async () => {}),
      close: vi.fn(() => {
        if (closed) return
        closed = true
        options.onClose?.('test disconnected')
      }),
      poll: () => socket.notices.splice(0),
    }
    sockets.push(socket)
    return socket
  }
  return { manager: new SharedNotifications(getCredentials, make), sockets, getCredentials }
}
function message(id = '42', peer = '8') {
  const raw = {
    scene: 1,
    channelId: peer,
    senderUserId: peer,
    msgBody: { msgId: id, msgTime: Date.now(), msgType: 1, text: { textBody: 'test' } },
  }
  return {
    msgType: 133,
    bizType: PRIVATE_REALTIME_BIZ,
    serverExt: { data: gzipSync(JSON.stringify(raw)).toString('base64') },
  }
}
const settle = () => vi.advanceTimersByTimeAsync(0)

it('shares one authenticated transport with matching and keeps background delivery after closing match', async () => {
  const x = setup()
  x.manager.enablePrivate('9')
  await x.manager.matchOpen('first')
  expect(x.sockets).toHaveLength(1)
  expect(x.getCredentials).toHaveBeenCalledOnce()
  expect(x.sockets[0].options.persistent).toBe(true)
  x.manager.matchClose('stale')
  expect(x.manager.matchPoll('first')).toEqual([])
  x.manager.matchClose('first')
  expect(x.sockets[0].close).not.toHaveBeenCalled()
  x.sockets[0].options.onNotification?.(message(), Date.now())
  const feed = x.manager.poll(0)
  expect(feed.connected).toBe(true)
  expect(feed.events.map((event) => event.notice.kind)).toEqual(['sync', 'message'])
  expect(JSON.stringify(feed)).not.toContain('test-im-token')
  expect(x.manager.poll(0)).toEqual(feed)
  expect(x.manager.poll(feed.cursor, feed.session).events).toEqual([])
  x.manager.close()
  expect(x.sockets[0].close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('adopts an existing matching socket when the account becomes verified', async () => {
  const x = setup()
  await x.manager.matchOpen('first')
  expect(x.manager.poll(0).events).toEqual([])
  x.manager.enablePrivate('9')
  x.manager.enablePrivate('9')
  x.manager.matchClose('first')
  expect(x.sockets).toHaveLength(1)
  expect(x.manager.poll(0).events).toHaveLength(1)
  expect(x.sockets[0].close).not.toHaveBeenCalled()
  x.manager.close()
})

it('backs off credential failures, does not retry on repeated account queries, and emits sync on recovery', async () => {
  const get = vi
    .fn(async () => credentials)
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('still offline'))
  const x = setup(get)
  x.manager.enablePrivate('9')
  await settle()
  expect(x.manager.poll(0).connected).toBe(false)
  x.manager.enablePrivate('9')
  await vi.advanceTimersByTimeAsync(999)
  expect(get).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(get).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1999)
  expect(get).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  expect(get).toHaveBeenCalledTimes(3)
  expect(x.manager.poll(0)).toMatchObject({ connected: true, cursor: 1 })
  x.manager.close()
})

it('invalidates an interrupted matching attempt while reconnecting the inbox and deduplicating replayed messages', async () => {
  const x = setup()
  x.manager.enablePrivate('9')
  await x.manager.matchOpen('old')
  const notice = message()
  x.sockets[0].options.onNotification?.(notice, Date.now())
  x.sockets[0].options.onClose?.('connection lost')
  expect(() => x.manager.matchPoll('old')).toThrow('connection lost')
  await vi.advanceTimersByTimeAsync(1000)
  expect(x.sockets).toHaveLength(2)
  x.sockets[1].options.onNotification?.(notice, Date.now())
  expect(x.manager.poll(0).events.map((event) => event.notice.kind)).toEqual([
    'sync',
    'message',
    'sync',
  ])
  expect(() => x.manager.matchPoll('old')).toThrow('connection lost')
  x.sockets[1].notices.push({
    timestamp: Date.now(),
    notice: { kind: 'ready', roomId: 'old-room' },
  })
  await x.manager.matchOpen('new')
  expect(x.manager.matchPoll('new')).toEqual([])
  x.manager.matchClose('old')
  expect(x.manager.matchPoll('new')).toEqual([])
  x.manager.close()
})

it('cancels pending credentials and ignores all callbacks after disposal', async () => {
  let resolve!: (value: typeof credentials) => void
  const x = setup(
    vi.fn(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    ),
  )
  x.manager.enablePrivate('9')
  x.manager.close()
  resolve(credentials)
  await settle()
  expect(x.sockets[0].open).not.toHaveBeenCalled()
  x.sockets[0].options.onNotification?.(message(), Date.now())
  x.sockets[0].options.onClose?.('late close')
  expect(x.manager.poll(0)).toMatchObject({ connected: false, events: [] })
  expect(vi.getTimerCount()).toBe(0)
})

it('isolates private feeds and old socket callbacks when the verified account changes', async () => {
  const x = setup()
  x.manager.enablePrivate('9')
  await settle()
  x.sockets[0].options.onNotification?.(message(), Date.now())
  const previous = x.manager.poll(0)
  x.manager.enablePrivate('7')
  await settle()
  x.sockets[0].options.onNotification?.(message('100'), Date.now())
  const next = x.manager.poll(previous.cursor, previous.session)
  expect(next.session).not.toBe(previous.session)
  expect(next.reset).toBe(true)
  expect(next.events.map((event) => event.notice.kind)).toEqual(['sync'])
  expect(x.sockets[0].close).toHaveBeenCalledOnce()
  x.manager.close()
})

it('bounds the cursor feed, signals missed events, and rejects invalid cursors', async () => {
  const x = setup()
  x.manager.enablePrivate('9')
  await settle()
  const first = x.manager.poll(0)
  for (let id = 1; id <= 300; id++)
    x.sockets[0].options.onNotification?.(message(String(id)), Date.now())
  const next = x.manager.poll(first.cursor, first.session)
  expect(next.reset).toBe(true)
  expect(next.events).toHaveLength(256)
  expect(next.cursor).toBe(301)
  expect(next.events[0].sequence).toBe(46)
  expect(x.manager.poll(0).events).toHaveLength(256)
  expect(() => x.manager.poll(-1)).toThrow('游标')
  expect(() => x.manager.poll(NaN)).toThrow('游标')
  x.manager.close()
})

it('expires idle matching leases without terminating a persistent inbox', async () => {
  const x = setup()
  x.manager.enablePrivate('9')
  await x.manager.matchOpen('idle')
  await vi.advanceTimersByTimeAsync(30000)
  expect(() => x.manager.matchPoll('idle')).toThrow('页面已关闭')
  expect(x.manager.poll(0).connected).toBe(true)
  expect(x.sockets[0].close).not.toHaveBeenCalled()
  x.manager.close()
  const y = setup()
  await y.manager.matchOpen('idle')
  await vi.advanceTimersByTimeAsync(30000)
  expect(y.sockets[0].close).toHaveBeenCalledOnce()
  expect(() => y.manager.matchPoll('idle')).toThrow('页面已关闭')
  y.manager.close()
})
