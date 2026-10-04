import { expect, it, vi } from 'vitest'
import type { ChatMessage } from '../vendor/music-party/src/shared/types'
import {
  DanmakuFilter,
  DanmakuQueue,
  DanmakuTracks,
  danmakuGeometry,
} from '../src/client/chat-danmaku-layout'
import { DanmakuClock, danmakuElapsedAtX } from '../src/client/chat-danmaku-clock'
import { danmakuDefaults } from '../src/client/chat-preferences'

const message = (id: string, text: string, kind: ChatMessage['kind'] = 'text'): ChatMessage => ({
  id,
  text,
  kind,
  uid: '9',
  nickname: '听友',
  avatar: '',
  roomId: 'room',
  time: 1,
})

it('pauses a single comment clock for longer than its lifetime without stopping other clocks', () => {
  let now = 0
  const first = new DanmakuClock(() => now),
    other = new DanmakuClock(() => now),
    paused = vi.fn(),
    played = vi.fn()
  first.addEventListener('pause', paused)
  first.addEventListener('play', played)
  first.play()
  other.play()
  now = 2000
  first.pause()
  first.pause()
  now = 62000
  expect(first.paused).toBe(true)
  expect(first.currentTime).toBe(2)
  expect(other.currentTime).toBe(62)
  first.play()
  first.play()
  now = 64000
  expect(first.currentTime).toBe(4)
  expect(first.paused).toBe(false)
  expect(paused).toHaveBeenCalledTimes(1)
  expect(played).toHaveBeenCalledTimes(2)
})

it('rebases elapsed time without losing a paused state or an in-flight horizontal position', () => {
  let now = 0
  const clock = new DanmakuClock(() => now)
  clock.play()
  now = 3000
  clock.pause()
  clock.retime(2)
  now = 60000
  expect(clock.paused).toBe(true)
  expect(clock.currentTime).toBe(2)
  clock.play()
  now = 61000
  expect(clock.currentTime).toBe(3)
  clock.retime(4)
  expect(clock.paused).toBe(false)
  now = 62000
  expect(clock.currentTime).toBe(5)

  const x = 440,
    elapsed = danmakuElapsedAtX(x, 1100, 360, 6)
  expect(1100 - ((1100 + 360) * elapsed) / 6).toBeCloseTo(x)
  expect(danmakuElapsedAtX(1200, 1100, 360, 6)).toBe(0)
  expect(danmakuElapsedAtX(-600, 1100, 360, 6)).toBe(6)
})

it('keeps paused tracks occupied while other tracks may finish and accept another message', () => {
  const tracks = new DanmakuTracks(2)
  expect(tracks.claim('hovered', false)).toBe(0)
  expect(tracks.claim('moving', false)).toBe(1)
  expect(tracks.claim('queued', false)).toBeNull()
  tracks.release('moving')
  expect(tracks.claim('queued', false)).toBe(1)
  expect(tracks.claim('later', false)).toBeNull()
  tracks.release('hovered')
  expect(tracks.claim('later', false)).toBe(0)
})

it('allows explicit overlap while bounding active instances even on a large screen', () => {
  const tracks = new DanmakuTracks(2)
  for (let i = 0; i < 40; i++) expect(tracks.claim(String(i), true)).toBe(i % 2)
  expect(tracks.claim('overflow', true)).toBeNull()
  tracks.release('3')
  expect(tracks.claim('next', true)).not.toBeNull()
  expect(new DanmakuTracks(0).claim('x', true)).toBeNull()
})

it('fits complete rows in the configured area and preserves speed ratios across window sizes', () => {
  const normal = danmakuGeometry(1800, 1000, danmakuDefaults),
    large = danmakuGeometry(1800, 1000, { ...danmakuDefaults, danmakuFontSize: 150 }),
    narrow = danmakuGeometry(400, 1000, danmakuDefaults),
    fast = danmakuGeometry(1800, 1000, { ...danmakuDefaults, danmakuSpeed: 150 }),
    reduced = danmakuGeometry(1800, 1000, danmakuDefaults, true)
  expect(normal.height).toBeLessThanOrEqual((1000 - 48) * 0.55)
  expect(normal.rows).toBeGreaterThan(large.rows)
  expect(normal.speed).toBe(200)
  expect(normal.duration).toBe(9)
  expect(narrow.duration).toBe(9)
  expect(fast.duration).toBe(6)
  expect(reduced.duration).toBe(5)
  expect(danmakuGeometry(400, 100, danmakuDefaults).rows).toBe(0)
})

it('filters actual text, attachment images and activity independently', () => {
  const filter = new DanmakuFilter(),
    text = message('text', 'Hello 😊 (｡･ω･｡)'),
    image = {
      ...message('image', '[图片]'),
      attachments: [{ kind: 'image' as const, title: 'image', url: 'https://example.com/a.png' }],
    },
    activity = message('activity', '听友推荐了歌曲', 'resource')
  expect(
    filter.take(
      [text, image, activity],
      { ...danmakuDefaults, danmakuText: false, danmakuMedia: false },
      0,
    ),
  ).toEqual([activity])
  filter.clear()
  expect(
    filter.take([text, image, activity], { ...danmakuDefaults, danmakuActivity: false }, 0),
  ).toEqual([text, image])
})

it('merges repeated content within 15 seconds, preserving distinct media and the off switch', () => {
  const filter = new DanmakuFilter(),
    first = message('1', 'Hello'),
    same = { ...message('2', 'Hello'), uid: '10' },
    different = message('3', 'Another comment')
  expect(filter.take([first, same, different], danmakuDefaults, 0)).toEqual([first, different])
  expect(filter.take([same], danmakuDefaults, 10000)).toEqual([])
  expect(filter.take([same], danmakuDefaults, 15001)).toEqual([same])
  expect(filter.take([same], { ...danmakuDefaults, danmakuDedupe: false }, 15002)).toEqual([same])
  const images = ['a', 'b'].map((name) => ({
    ...message(name, '[图片]'),
    attachments: [{ kind: 'image' as const, title: '', url: `https://example.com/${name}.png` }],
  }))
  expect(filter.take(images, danmakuDefaults, 16000)).toEqual(images)
})

it('bounds bursts and discards stale queued messages instead of replaying them later', () => {
  const queue = new DanmakuQueue<string>(3, 12000)
  queue.push(['a', 'b', 'c', 'd'], 0)
  expect(queue.peek(0)).toBe('b')
  queue.shift()
  expect(queue.peek(0)).toBe('c')
  queue.push(['new'], 10000)
  expect(queue.peek(12001)).toBe('new')
  queue.clear()
  expect(queue.peek(12001)).toBeUndefined()
})
