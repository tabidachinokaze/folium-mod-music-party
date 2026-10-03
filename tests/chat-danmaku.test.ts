import { expect, it } from 'vitest'
import { DanmakuLanes, DanmakuQueue } from '../src/client/chat-danmaku-layout'

it('keeps equal pixel speed and a safe gap for both short and long followers', () => {
  const lanes = new DanmakuLanes(1, 100, 40),
    leading = lanes.claim(0, 400, 1000)!
  expect(leading.duration).toBe(14000)
  expect(lanes.claim(4399, 20, 1000)).toBeNull()
  const short = lanes.claim(4400, 20, 1000)!
  expect(short.duration).toBe(10200)
  expect(1000 - (4400 / leading.duration) * 1400 + 400).toBe(960)
  expect(lanes.claim(4999, 500, 1000)).toBeNull()
  expect(lanes.claim(5000, 500, 1000)?.duration).toBe(15000)
})

it('spreads messages across lanes and reports when a busy lane next opens', () => {
  const lanes = new DanmakuLanes(3, 100, 40)
  expect(lanes.claim(0, 400, 1000)?.lane).toBe(0)
  expect(lanes.claim(0, 100, 1000)?.lane).toBe(1)
  expect(lanes.claim(0, 200, 1000)?.lane).toBe(2)
  expect(lanes.claim(1000, 50, 1000)).toBeNull()
  expect(lanes.delay(1000)).toBe(400)
  expect(lanes.claim(1400, 50, 1000)?.lane).toBe(1)
})

it('reserves the whole display duration for reduced-motion stationary messages', () => {
  const lanes = new DanmakuLanes(1)
  expect(lanes.claim(0, 200, 1000, true)?.duration).toBe(5000)
  expect(lanes.claim(4999, 10, 1000, true)).toBeNull()
  expect(lanes.claim(5000, 10, 1000, true)).toEqual({ lane: 0, duration: 5000 })
  expect(new DanmakuLanes(0).claim(0, 100, 1000)).toBeNull()
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
