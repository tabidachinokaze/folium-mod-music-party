import { expect, it } from 'vitest'
import type { ChatMessage, RoomSnapshot } from '../vendor/music-party/src/shared/types'
import { ChatMessageFeed } from '../src/client/chat-message-feed'

const message = (id: string, time: number, roomId = 'room'): ChatMessage => ({
  id,
  time,
  roomId,
  uid: '9',
  nickname: '听友',
  avatar: '',
  text: id,
  kind: 'text',
})
const state = (messages: ChatMessage[] = [], roomId = 'room', uid = '9') => ({
  account: { uid, nickname: '听友' },
  room: { roomId } as RoomSnapshot,
  messages,
})

it('ignores cached history and older pagination while keeping every new ID at the same timestamp', () => {
  const feed = new ChatMessageFeed(() => 1000)
  expect(feed.take(state([message('last', 200)]))).toEqual([])
  expect(feed.take(state([message('old', 100), message('last', 200)]))).toEqual([])
  expect(feed.take(state([message('same-ms', 200), message('last', 200)]))).toEqual([
    message('same-ms', 200),
  ])
  expect(feed.take(state([message('last', 200), message('same-ms', 200)]))).toEqual([])
  expect(feed.take(state([message('newer', 300), message('last', 200)]))).toEqual([
    message('newer', 300),
  ])
})

it('does not lose the first live message when the room starts empty', () => {
  const feed = new ChatMessageFeed(() => 1000)
  expect(feed.take(state())).toEqual([])
  expect(feed.take(state())).toEqual([])
  expect(feed.take(state([message('first', 1100)]))).toEqual([message('first', 1100)])
  expect(feed.take(state([message('first', 1100)]))).toEqual([])
})

it('seeds delayed initial history, then uses server timestamps even with local clock skew', () => {
  const feed = new ChatMessageFeed(() => 1000)
  expect(feed.take(state())).toEqual([])
  expect(feed.take(state([message('history', 100)]))).toEqual([])
  expect(feed.take(state([message('history', 100), message('live', 200)]))).toEqual([
    message('live', 200),
  ])
})

it('drops unseen history while preserving live messages in a mixed initial response', () => {
  const feed = new ChatMessageFeed(() => 1000)
  feed.take(state())
  expect(feed.take(state([message('history', 100), message('live', 1001)]))).toEqual([
    message('live', 1001),
  ])
})

it('does not replay hidden or disabled messages when enabled again', () => {
  const feed = new ChatMessageFeed(() => 1000)
  feed.take(state([message('a', 100)]))
  expect(feed.take(state([message('b', 200)]), false)).toEqual([])
  expect(feed.take(state([message('b', 200), message('c', 300)]), true)).toEqual([])
  expect(feed.take(state([message('c', 300), message('d', 400)]))).toEqual([message('d', 400)])
})

it('isolates room/account changes and ignores mismatched rooms and unconfirmed delivery', () => {
  const feed = new ChatMessageFeed(() => 1000)
  feed.take(state([message('a', 100)]))
  expect(feed.take(state([message('b', 200)], 'room', '10'))).toEqual([])
  expect(feed.take(state([message('x', 300, 'other')], 'other', '10'))).toEqual([])
  expect(
    feed.take(
      state(
        [
          message('wrong', 400),
          { ...message('sending', 400, 'other'), delivery: 'sending' },
          { ...message('failed', 500, 'other'), delivery: 'failed' },
        ],
        'other',
        '10',
      ),
    ),
  ).toEqual([])
  expect(feed.take(state([message('confirmed', 400, 'other')], 'other', '10'))).toEqual([
    message('confirmed', 400, 'other'),
  ])
  expect(feed.take({ ...state(), room: null })).toEqual([])
  expect(feed.take(state([message('rejoined', 600)]))).toEqual([])
})
