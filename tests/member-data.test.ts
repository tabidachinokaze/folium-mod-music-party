import { expect, it, vi } from 'vitest'
import { loadQueue } from '../src/client/room-data'
import { multiPayload } from '../vendor/music-party/src/main/multi-api'
import { validate } from '../vendor/music-party/src/main/service'
import { parseSnapshot } from '../vendor/music-party/src/shared/multiplayer'

// tests/member-data.test.ts
it('uses the official played history endpoint payload and retains separate occurrences', async () => {
  expect(multiPayload('multiPlayed', { roomId: 'room', cursor: 'next' })).toEqual({
    roomId: 'room',
    sort: 1,
    page: JSON.stringify({ size: 20, cursor: 'next' }),
  })
  expect(() => validate({ method: 'multiPlayed', args: { roomId: 'room', uid: '9' } })).toThrow()
  const call = vi.fn(async (_method, args) => ({
    data: {
      songLists: [
        {
          songInfo: {
            resourceId: '10',
            bizId: args.cursor ? '2' : '1',
            zanCnt: args.cursor ? 5 : 3,
          },
          rcmdUid: '9',
        },
      ],
      page: { more: !args.cursor, cursor: 'next' },
    },
  }))
  const rows = await loadQueue(call, 'room', () => true, 'multiPlayed')
  expect(rows.map((row) => [row.songBizId, row.likeCount])).toEqual([
    ['1', 3],
    ['2', 5],
  ])
  expect(call.mock.calls.every(([method]) => method === 'multiPlayed')).toBe(true)
  expect(await loadQueue(call, 'room', () => false, 'multiPlayed')).toEqual([])
})
it('preserves room details and filters malformed tags without inventing metadata', () => {
  const room = parseSnapshot(
    {
      roomId: 'room',
      roomTagList: ['原声带', null],
      multiRoomInfoDTO: { creatorId: 9, roomCreateTime: 1790739422903 },
      multiLtRoomUserAgg: {
        onlineNums: 3,
        onlineUserInfos: [{ uid: 9, nickname: '房主', avatar: '' }],
      },
    },
    1,
  )
  expect(room).toMatchObject({
    creatorId: '9',
    createdAt: 1790739422903,
    tags: ['原声带'],
    onlineCount: 3,
  })
  expect(parseSnapshot({ roomId: 'room' }, 1).createdAt).toBeUndefined()
})
