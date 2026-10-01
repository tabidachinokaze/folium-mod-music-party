import { describe, expect, it, vi } from 'vitest'
import type { RoomQueueEntry } from '@party/shared/types'
import { PartyController } from '../src/client/controller'
import { nativeQueue } from '../src/client/native-queue'
import { withPromotionCount } from '../src/client/queue-counts'
import { fakeHost, snapshot } from './fixtures'

// tests/native-queue-counts.test.ts
function entry(bizId: string, count: unknown, uid = '9') {
  return withPromotionCount(
    {
      songId: '1',
      songBizId: bizId,
      songRcmdUid: uid,
      track: { id: '1', name: '同一首歌', artist: '歌手', album: '', cover: '', duration: 0 },
      recommender: '',
      selfRecommended: uid === '9',
      uped: false,
      upCount: 0,
      liked: false,
      likeCount: 0,
    } satisfies RoomQueueEntry,
    count,
  )
}
describe('official queue promotion counts', () => {
  it('shows each waiting occurrence count independently and keeps own-delete/current-like rules', () => {
    const host = fakeHost()
    host.folium.rpc.call = vi.fn().mockResolvedValue(undefined)
    const controller = new PartyController(host.folium)
    const state = {
      ...controller.state,
      account: { uid: '9', nickname: '我' },
      room: {
        roomId: 'room',
        chatRoomId: null,
        playback: snapshot(),
        members: [],
        onlineCount: 1,
        membersKnown: true,
      },
      queue: [entry('101', 7), entry('102', 0), entry('103', 4, '8'), entry('104', undefined)],
    }
    const queue = nativeQueue(state, null)
    expect(
      queue.entries.map((song) => [
        song.id,
        song.actions.find((action) => action.id === 'promote')?.count,
      ]),
    ).toEqual([
      ['101', undefined],
      ['102', 0],
      ['103', 4],
      ['104', undefined],
    ])
    expect(queue.entries[0].actions.map((action) => action.id)).toEqual(['like'])
    expect(queue.entries[1].actions.map((action) => action.id)).toEqual(['promote', 'remove'])
    expect(queue.entries[2].actions.map((action) => action.id)).toEqual(['promote'])
    expect(
      nativeQueue({ ...state, busy: true }, null).entries[1].actions.every(
        (action) => action.disabled,
      ),
    ).toBe(true)
    controller.dispose()
  })
})
