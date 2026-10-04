import { EventEmitter } from 'node:events'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, it, vi } from 'vitest'
import {
  frame,
  FrameReader,
  packet,
  properties,
  readProperties,
  streamCipher,
} from '../src/main/mini-codec'
import {
  MiniNotifications,
  MUSIC_MINI_APP_KEY,
  type MiniNotificationOptions,
} from '../src/main/mini-notifications'
import { parsePrivateNotice, PRIVATE_REALTIME_BIZ } from '../src/main/private-notice'

// tests/mini-notifications.test.ts
const state = vi.hoisted(() => ({ socket: null as any }))
vi.mock('node:net', () => ({ connect: vi.fn(() => state.socket) }))
vi.mock('node:crypto', async (original) => ({
  ...(await original<typeof import('node:crypto')>()),
  randomBytes: () => Buffer.alloc(16, 42),
}))
afterEach(() => vi.useRealTimers())
function setup(options?: MiniNotificationOptions) {
  const socket = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    destroy: vi.fn(),
    setNoDelay: vi.fn(),
  })
  state.socket = socket
  const transport = new MiniNotifications(options),
    encrypt = streamCipher(Buffer.alloc(16, 42))
  const send = (
    service: number,
    command: number,
    body: Buffer = Buffer.alloc(0),
    status?: number,
  ) => {
    let bytes = frame(service, command, 1, body)
    if (status !== undefined) {
      const head = Buffer.from([service, command, 1, 0, 2, status & 255, status >> 8])
      bytes = Buffer.concat([Buffer.from([head.length + body.length]), head, body])
    }
    socket.emit('data', encrypt(bytes))
  }
  const login = async () => {
    const pending = transport.open({ accId: 'test-account', token: 'test-token' })
    socket.emit('connect')
    send(1, 5, undefined, 200)
    send(2, 2, undefined, 200)
    await pending
  }
  return { transport, socket, send, login }
}
it('uses the verified production application, delivers only matching notices and acknowledges duplicate envelopes', async () => {
  const x = setup()
  await x.login()
  const decrypt = streamCipher(Buffer.alloc(16, 42)),
    reader = new FrameReader()
  const auth = readProperties(packet(reader.push(decrypt(x.socket.write.mock.calls[1][0]))[0]).body)
  expect(MUSIC_MINI_APP_KEY).toBe('688ebe2a6a7da3d1125936d9ee8b0966')
  expect(auth.get(18)).toBe(MUSIC_MINI_APP_KEY)
  expect(auth.get(3)).toBe('64')
  expect(auth.get(8)).toBe('0')
  const notify = (id: number, business: string) => {
    const unique = Buffer.alloc(8)
    unique.writeBigInt64LE(BigInt(id))
    const content = JSON.stringify({
      msgType: 133,
      bizType: business,
      serverExt: JSON.stringify({
        subType: 'STRANGER_MULTI_MATCH_WAIT_ACK',
        data: { roomId: 'test-room' },
      }),
    })
    const inner = frame(7, 3, 0, properties({ 0: 123, 1: 100, 5: content }))
    x.send(4, 1, Buffer.concat([unique, inner]))
  }
  notify(1, 'other-business')
  notify(2, 'music_listenTogether_multi_match_song')
  notify(2, 'music_listenTogether_multi_match_song')
  expect(x.transport.poll()).toEqual([
    { timestamp: 123, notice: { kind: 'ready', roomId: 'test-room' } },
  ])
  expect(x.transport.poll()).toEqual([])
  const receipts = x.socket.write.mock.calls
    .slice(2)
    .flatMap(([bytes]) => reader.push(decrypt(bytes)))
    .map(packet)
  expect(receipts).toHaveLength(3)
  expect(receipts.every((r) => r.service === 4 && r.command === 3)).toBe(true)
  x.transport.close()
  x.transport.close()
  expect(x.socket.destroy).toHaveBeenCalledOnce()
})
it.each([0n, -1n])(
  'dispatches consecutive throughtrain and private notifications with non-unique envelope ID %s',
  async (id) => {
    const onNotification = vi.fn()
    const x = setup({ persistent: true, onNotification })
    await x.login()
    const timestamp = Date.now()
    const throughtrain = JSON.stringify({
      msgType: 133,
      bizType: 'music_friend_throughtrain_notice',
      serverExt: JSON.stringify({ simpleUserProfile: { userId: 8 }, title: 'test' }),
    })
    const privateNotice = JSON.stringify({
      msgType: 133,
      bizType: PRIVATE_REALTIME_BIZ,
      serverExt: JSON.stringify({
        data: gzipSync(
          JSON.stringify({
            scene: 1,
            channelId: '8',
            senderUserId: '8',
            msgBody: {
              msgId: 'test-private-message',
              msgTime: timestamp,
              msgType: 1,
              text: { textBody: 'test' },
            },
          }),
        ).toString('base64'),
      }),
    })
    const envelopeId = Buffer.alloc(8)
    envelopeId.writeBigInt64LE(id)
    for (const content of [throughtrain, privateNotice]) {
      const inner = frame(7, 3, 0, properties({ 0: timestamp, 1: 100, 5: content }))
      x.send(4, 1, Buffer.concat([envelopeId, inner]))
    }
    expect(onNotification).toHaveBeenCalledTimes(2)
    expect(onNotification).toHaveBeenNthCalledWith(1, throughtrain, timestamp)
    expect(parsePrivateNotice(onNotification.mock.calls[1][0], timestamp, '9')).toMatchObject({
      kind: 'message',
      peerUid: '8',
      messageId: 'test-private-message',
      text: 'test',
    })
    expect(x.socket.write).toHaveBeenCalledTimes(2) // Handshake/login only; no ACK for these IDs.
    expect(x.socket.destroy).not.toHaveBeenCalled()
    x.transport.close()
  },
)
it('rejects pending authentication on cancellation and ignores later bytes', async () => {
  const x = setup(),
    pending = x.transport.open({ accId: 'test', token: 'test' })
  x.transport.close()
  await expect(pending).rejects.toThrow('取消')
  x.send(1, 5, undefined, 200)
  expect(x.socket.write).not.toHaveBeenCalled()
})
it('closes idle connections and rejects malformed authenticated frames', async () => {
  vi.useFakeTimers()
  const x = setup()
  await x.login()
  await vi.advanceTimersByTimeAsync(30000)
  expect(() => x.transport.poll()).toThrow('页面已关闭')
  const y = setup()
  await y.login()
  y.send(7, 3, Buffer.from([1, 5, 127]))
  expect(() => y.transport.poll()).toThrow('字段')
  expect(y.socket.destroy).toHaveBeenCalledOnce()
})

it('keeps persistent heartbeats beyond the matching lifetime and closes a half-open socket', async () => {
  vi.useFakeTimers()
  const onClose = vi.fn()
  const x = setup({ persistent: true, onClose })
  await x.login()
  for (let index = 0; index < 18; index++) {
    await vi.advanceTimersByTimeAsync(10000)
    x.send(1, 2)
  }
  expect(x.transport.poll()).toEqual([])
  expect(x.socket.destroy).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(50000)
  expect(() => x.transport.poll()).toThrow('心跳超时')
  expect(onClose).toHaveBeenCalledOnce()
  x.transport.close()
  expect(onClose).toHaveBeenCalledOnce()
})

it('dispatches other verified notification businesses without letting a subscriber exception break the socket', async () => {
  const onNotification = vi.fn(() => {
    throw new Error('subscriber failed')
  })
  const x = setup({ persistent: true, onNotification })
  await x.login()
  x.send(7, 3, properties({ 0: 123, 5: 'other-business-content' }))
  expect(onNotification).toHaveBeenCalledWith('other-business-content', 123)
  expect(x.transport.poll()).toEqual([])
  expect(x.socket.destroy).not.toHaveBeenCalled()
  x.transport.close()
})
