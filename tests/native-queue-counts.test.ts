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

describe('native queue recommender names', () => {
  it('keeps names per recommendation, using known members and accounts without inventing names', () => {
    const host = fakeHost()
    host.folium.rpc.call = vi.fn().mockResolvedValue(undefined)
    const controller = new PartyController(host.folium)
    const state = {
      ...controller.state,
      account: { uid: '9', nickname: 'My name' },
      room: {
        roomId: 'room',
        chatRoomId: null,
        playback: snapshot(),
        members: [{ uid: '8', nickname: 'Current member name', avatar: '' }],
        onlineCount: 2,
        membersKnown: true,
      },
      queue: [
        { ...entry('101', 0), recommender: 'Old self name' },
        { ...entry('102', 0, '8'), recommender: 'Old member name' },
        { ...entry('103', 0, '7'), recommender: 'Member who left' },
        { ...entry('104', 0, '0'), recommender: 'System recommendation' },
        entry('105', 0, '6'),
      ],
    }
    expect(nativeQueue(state, null).entries.map((row) => [row.id, row.overline?.en])).toEqual([
      ['101', 'My name'],
      ['102', 'Current member name'],
      ['103', 'Member who left'],
      ['104', 'System recommendation'],
      ['105', undefined],
    ])
    controller.dispose()
  })

  it('uses the current occurrence owner before queue history arrives and ignores another occurrence of the same song', () => {
    const host = fakeHost()
    host.folium.rpc.call = vi.fn().mockResolvedValue(undefined)
    const controller = new PartyController(host.folium)
    const state = {
      ...controller.state,
      room: {
        roomId: 'room',
        chatRoomId: null,
        playback: snapshot(),
        members: [{ uid: '9', nickname: 'Current owner', avatar: '' }],
        onlineCount: 1,
        membersKnown: true,
      },
      queue: [{ ...entry('another-occurrence', 0, '8'), recommender: 'Other owner' }],
    }
    expect(nativeQueue(state, null).entries.map((row) => row.overline?.en)).toEqual([
      'Current owner',
      'Other owner',
    ])
    expect(
      nativeQueue({ ...state, room: { ...state.room, members: [] } }, null).entries[0].overline,
    ).toBeUndefined()
    controller.dispose()
  })

  it.each([
    { uid: '0', label: { 'zh-CN': '系统推荐', en: 'System recommendation' } },
    { uid: '7', label: undefined },
    { uid: '', label: undefined },
  ])('labels current and waiting recommendations only for system uid ($uid)', ({ uid, label }) => {
    const host = fakeHost()
    host.folium.rpc.call = vi.fn().mockResolvedValue(undefined)
    const controller = new PartyController(host.folium)
    const playback = snapshot()
    playback.song!.songRcmdUid = uid
    const state = {
      ...controller.state,
      room: {
        roomId: 'room',
        chatRoomId: null,
        playback,
        members: [],
        onlineCount: 0,
        membersKnown: true,
      },
      queue: [entry('102', 0, uid)],
    }
    expect(nativeQueue(state, null).entries.map((row) => row.overline)).toEqual([label, label])
    controller.dispose()
  })
})
