import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import {
  frame,
  FrameReader,
  packet,
  properties,
  readProperties,
  streamCipher,
} from '../src/main/mini-codec'
import { MiniNotifications, MUSIC_MINI_APP_KEY } from '../src/main/mini-notifications'

// tests/mini-notifications.test.ts
const state = vi.hoisted(() => ({ socket: null as any }))
vi.mock('node:net', () => ({ connect: vi.fn(() => state.socket) }))
vi.mock('node:crypto', async (original) => ({
  ...(await original<typeof import('node:crypto')>()),
  randomBytes: () => Buffer.alloc(16, 42),
}))
afterEach(() => vi.useRealTimers())
function setup() {
  const socket = Object.assign(new EventEmitter(), {
    write: vi.fn(),
    destroy: vi.fn(),
    setNoDelay: vi.fn(),
  })
  state.socket = socket
  const transport = new MiniNotifications(),
    encrypt = streamCipher(Buffer.alloc(16, 42))
  const send = (service: number, command: number, body = Buffer.alloc(0), status?: number) => {
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
