import { expect, it, vi } from 'vitest'
import { createMatchChannel } from '../src/client/match-channel'

// tests/match-channel.test.ts
const transport = vi.hoisted(() => ({ receive: (_event: any) => {}, close: vi.fn() }))
vi.mock('../src/client/match-sdk', () => ({
  createMatchSdk: async () => ({
    login: vi.fn(async () => {}),
    close: transport.close,
    onNotification: (receive: any) => {
      transport.receive = receive
    },
    onDisconnect: vi.fn(),
  }),
}))
const notification = (timestamp: number, receiverId = '9') => ({
  timestamp,
  receiverId,
  content: JSON.stringify({
    msgType: 133,
    bizType: 'music_listenTogether_multi_match_song',
    serverExt: JSON.stringify({
      subType: 'STRANGER_MULTI_MATCH_WAIT_ACK',
      data: { roomId: 'official_room' },
    }),
  }),
})
it('buffers early notifications and compares server time without relying on the local clock', async () => {
  const channel = createMatchChannel(),
    receive = vi.fn()
  await channel.connect({ accId: '9', token: 'fake' }, receive, vi.fn())
  transport.receive(notification(1000))
  channel.arm()
  transport.receive(notification(1000))
  transport.receive(notification(9000, 'other'))
  transport.receive(notification(9000))
  expect(receive).not.toHaveBeenCalled()
  channel.confirmStart(8000)
  expect(receive).toHaveBeenCalledExactlyOnceWith({ kind: 'ready', roomId: 'official_room' })
  channel.close()
  transport.receive(notification(10000))
  expect(receive).toHaveBeenCalledTimes(1)
})
it('does not deliver buffered notifications after cancellation', async () => {
  const channel = createMatchChannel(),
    receive = vi.fn()
  await channel.connect({ accId: '9', token: 'fake' }, receive, vi.fn())
  channel.arm()
  transport.receive(notification(9000))
  channel.close()
  channel.confirmStart(8000)
  expect(receive).not.toHaveBeenCalled()
})
