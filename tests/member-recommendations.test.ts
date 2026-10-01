import { expect, it } from 'vitest'
import type { RoomQueueEntry, RoomSnapshot } from '@party/shared/types'
import {
  currentRecommendationOwner,
  currentRoomRecommendation,
  memberRecommendationGroups,
} from '../src/client/member-recommendations'
import { promotionCount } from '../src/client/queue-counts'
import { snapshot, song } from './fixtures'

// tests/member-recommendations.test.ts
const room: RoomSnapshot = {
  roomId: 'room',
  playback: { ...snapshot(), likeCount: 12 },
  members: [{ uid: '9', nickname: '推荐人', avatar: 'https://example.test/avatar.png' }],
  membersKnown: true,
  onlineCount: 1,
  chatRoomId: null,
}
function entry(bizId: string, uid = '9'): RoomQueueEntry {
  return {
    songId: '1',
    songBizId: bizId,
    songRcmdUid: uid,
    track: { id: '1', name: '同一首歌', artist: '歌手', album: '', cover: '', duration: 0 },
    recommender: '推荐人',
    selfRecommended: uid === '9',
    uped: false,
    upCount: 4,
    liked: false,
    likeCount: 2,
  }
}
it('synthesizes current playback before played history catches up and uses host metadata', () => {
  const current = currentRoomRecommendation(room, [], song())!
  expect(current.track.name).toBe('歌曲 1')
  expect(current.likeCount).toBe(12)
  expect(promotionCount(current)).toBeUndefined()
  const groups = memberRecommendationGroups('9', [entry('100')], [entry('102')], current)
  expect(groups.played.map((row) => row.songBizId)).toEqual(['101', '100'])
  expect(groups.waiting.map((row) => row.songBizId)).toEqual(['102'])
  expect(currentRecommendationOwner(room, current)).toEqual(room.members[0])
})
it('moves the current occurrence from waiting to played once without merging repeated recordings', () => {
  const rows = [entry('101'), entry('102')]
  const current = currentRoomRecommendation(room, rows, null)
  const groups = memberRecommendationGroups(
    '9',
    [entry('101'), entry('100'), entry('102')],
    [...rows, entry('102')],
    current,
  )
  expect(groups.played.map((row) => [row.songBizId, row.likeCount])).toEqual([
    ['101', 12],
    ['100', 2],
  ])
  expect(groups.waiting.map((row) => row.songBizId)).toEqual(['102'])
})
it('does not assign system recommendations to the viewer or borrow another playing track', () => {
  const systemRoom = {
    ...room,
    playback: { ...room.playback!, song: { ...room.playback!.song!, songRcmdUid: '0' } },
  }
  const current = currentRoomRecommendation(systemRoom, [], song('2'))!
  expect(current.track.name).toBe('正在加载房间歌曲…')
  expect(currentRecommendationOwner(systemRoom, current)?.nickname).toBe('系统推荐')
  expect(memberRecommendationGroups('9', [], [], current).played).toEqual([])
})
it('keeps recommendation metadata when its owner has left the room and refreshes live identity', () => {
  const current = currentRoomRecommendation({ ...room, members: [] }, [entry('101', '8')], null)!
  expect(current.songRcmdUid).toBe('9')
  expect(currentRecommendationOwner({ ...room, members: [] }, current)).toEqual({
    uid: '9',
    nickname: '推荐人',
    avatar: '',
  })
  expect(currentRoomRecommendation({ ...room, playback: null }, [], song())).toBeNull()
  expect(currentRecommendationOwner(room, null)).toBeNull()
})
