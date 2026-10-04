import { describe, expect, it } from 'vitest'
import type { PrivateMessage, PrivatePage } from '@party/shared/types'
import { PrivateHistoryGaps } from '../src/client/private-history-gaps'

// tests/private-history-gaps.test.ts
const message = (time: number): PrivateMessage => ({
  id: String(time),
  senderId: '1',
  recipientId: '2',
  time,
  text: String(time),
  invitations: [],
})
const page = (before: number | null, more = true): PrivatePage => ({
  before,
  more,
  messages: before === null ? [] : [message(before)],
})

describe('private-message refresh gaps', () => {
  it('does not request old history for the first snapshot or overlapping latest pages', () => {
    const gaps = new PrivateHistoryGaps()
    gaps.observe([], page(100))
    gaps.observe([message(100)], page(90))
    gaps.observe([message(100)], page(100))
    gaps.observe([message(100)], page(200, false))
    expect(gaps.next()).toBeNull()
  })
  it('keeps a catch-up cursor across refreshes without replacing the oldest history cursor', () => {
    const gaps = new PrivateHistoryGaps()
    gaps.observe([message(10), message(100)], page(300))
    expect(gaps.next()).toBe(300)
    gaps.accept(300, page(200))
    expect(gaps.next()).toBe(200)
    gaps.accept(200, page(95))
    expect(gaps.next()).toBeNull()
  })
  it('merges overlapping gaps but retains distinct bursts while old catch-up is in progress', () => {
    const gaps = new PrivateHistoryGaps()
    gaps.observe([message(100)], page(300))
    gaps.observe([message(200)], page(400))
    gaps.observe([message(600)], page(800))
    expect(gaps.next()).toBe(400)
    gaps.accept(400, page(50))
    expect(gaps.next()).toBe(800)
    gaps.accept(800, page(700, false))
    expect(gaps.next()).toBeNull()
  })
  it('rejects nonadvancing pages without dropping the missing range and clears on account/peer change', () => {
    const gaps = new PrivateHistoryGaps()
    gaps.observe([message(100)], page(300))
    expect(() => gaps.accept(300, page(300))).toThrow('未向前推进')
    expect(gaps.next()).toBe(300)
    gaps.clear()
    expect(gaps.next()).toBeNull()
  })
})
