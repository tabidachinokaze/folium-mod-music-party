import { afterEach, expect, it, vi } from 'vitest'
import { RoomMatch } from '../src/client/room-match'
import { parseMatchNotice, type MatchNotice } from '../src/client/match-channel'
import type { AccountConnection } from '../src/client/host'
import { rawSnapshot } from './fixtures'

// tests/matching.test.ts
afterEach(() => vi.useRealTimers())
const envelope = (
  subType: string,
  data: unknown,
  bizType = 'music_listenTogether_multi_match_song',
) => JSON.stringify({ msgType: 133, bizType, serverExt: JSON.stringify({ subType, data }) })
it('accepts only official multiplayer matching notices with validated room identity', () => {
  expect(
    parseMatchNotice(envelope('STRANGER_MULTI_MATCH_WAIT_ACK', { roomId: 'official_room' })),
  ).toEqual({ kind: 'ready', roomId: 'official_room' })
  expect(
    parseMatchNotice(
      envelope(
        'STRANGER_MULTI_MATCH_WAIT_ACK',
        { roomId: 'official_room' },
        'music_listenTogether_multi_invite',
      ),
    ),
  ).toBeNull()
  expect(
    parseMatchNotice(envelope('STRANGER_MULTI_MATCH_WAIT_ACK', { roomId: '../evil' })),
  ).toBeNull()
  expect(
    parseMatchNotice(envelope('STRANGER_MULTI_MATCH_FAILED', { failedType: 'NO_MATCH' })),
  ).toEqual({ kind: 'failed', reason: 'NO_MATCH' })
  expect(parseMatchNotice('{not json')).toBeNull()
})
function setup() {
  let receive = (_notice: MatchNotice) => {}
  const channel = {
    connect: vi.fn(async (_credentials: unknown, callback: (event: MatchNotice) => void) => {
      receive = callback
    }),
    arm: vi.fn(),
    confirmStart: vi.fn(),
    close: vi.fn(),
  }
  const connection = {
    attachment: vi.fn(async () => ({ accId: '9', token: 'fake' })),
    call: vi.fn(async (method: string, _args?: unknown): Promise<any> =>
      method === 'multiJoin'
        ? { data: { multiLtRoomSnapshot: rawSnapshot() } }
        : { data: { success: true } },
    ),
  }
  const update = vi.fn(),
    accept = vi.fn(),
    fail = vi.fn()
  const match = new RoomMatch(
    connection as unknown as AccountConnection,
    update,
    accept,
    fail,
    () => channel,
  )
  return {
    match,
    channel,
    connection,
    update,
    accept,
    fail,
    receive: (event: MatchNotice) => receive(event),
  }
}
it('listens before starting match and acknowledges a pushed room even when status has no snapshot', async () => {
  vi.useFakeTimers()
  const x = setup()
  await x.match.start('1')
  expect(x.channel.connect.mock.invocationCallOrder[0]).toBeLessThan(
    x.connection.call.mock.invocationCallOrder[0],
  )
  x.receive({ kind: 'ready', roomId: 'official_room' })
  x.receive({ kind: 'ready', roomId: 'official_room' })
  await vi.advanceTimersByTimeAsync(0)
  expect(x.connection.call.mock.calls.filter(([method]) => method === 'multiJoin')).toHaveLength(1)
  expect(x.accept).toHaveBeenCalledWith(rawSnapshot())
  expect(x.channel.close).toHaveBeenCalledTimes(1)
  x.match.close()
})
it('hard timeout resolves a hanging login and allows a later attempt', async () => {
  vi.useFakeTimers()
  const x = setup()
  x.channel.connect.mockImplementationOnce(() => new Promise(() => {}))
  const pending = x.match.start('1')
  await vi.advanceTimersByTimeAsync(20000)
  await pending
  expect(x.update).toHaveBeenLastCalledWith(false, '')
  expect(x.fail).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining('超时') }),
  )
  expect(x.connection.call).not.toHaveBeenCalled()
  await x.match.start('2')
  expect(x.connection.call).toHaveBeenCalledWith('multiMatch', { songId: '2' })
  await x.match.cancel()
})
it('a failed official notice immediately ends matching instead of waiting for polling', async () => {
  const x = setup()
  await x.match.start('1')
  x.receive({ kind: 'failed', reason: 'NO_MATCH' })
  expect(x.update).toHaveBeenLastCalledWith(false, '')
  expect(x.fail).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringContaining('NO_MATCH') }),
  )
  expect(x.accept).not.toHaveBeenCalled()
  x.match.close()
})
