import { describe, expect, it, vi } from 'vitest'
import { PrivateBubbleInbox } from '../src/client/private-bubble-inbox'
import {
  privateReadBoundary,
  publishPrivateRead,
  subscribePrivateRead,
} from '../src/client/private-view-activity'
import type { PrivateMessageNotice } from '../src/shared/private-notices'
import type { PartyController } from '../src/client/controller'

const now = 1700000000000
const notice = (messageId: string, timestamp = now, peerUid = '8'): PrivateMessageNotice => ({
  kind: 'message',
  id: `${peerUid}:${messageId}:1`,
  peerUid,
  senderUid: peerUid,
  messageId,
  timestamp,
  messageType: 1,
  text: 'Test message',
  self: false,
})

describe('private bubble read boundary', () => {
  it('captures only incoming server IDs at the latest loaded millisecond', () => {
    const messages = [
      { id: 'server:older', time: now - 1, senderId: '8' },
      { id: 'server:first', time: now, senderId: '8' },
      { id: 'server:second', time: now, senderId: '8' },
      { id: 'server:own', time: now + 10, senderId: '9' },
      { id: 'synthesized-message', time: now, senderId: '8' },
    ]
    const boundary = privateReadBoundary(messages, '9')
    messages.push({ id: 'server:later', time: now + 1, senderId: '8' })
    expect(boundary).toEqual({ timestamp: now, messageIds: ['first', 'second'] })
    expect(privateReadBoundary([], '9')).toEqual({ timestamp: 0, messageIds: [] })
  })

  it('does not let an in-flight old read clear a newer push or a distinct same-time push', () => {
    const inbox = new PrivateBubbleInbox(() => now)
    inbox.receive(notice('first'), '9')
    const boundary = privateReadBoundary([{ id: 'server:first', time: now, senderId: '8' }], '9')
    // Both notifications arrive after the HTTP read starts, before its success callback.
    inbox.receive(notice('same-time'), '9')
    inbox.receive(notice('later', now + 1), '9')
    expect(inbox.read('8', boundary)).toBe(false)
    expect(inbox.conversations.get('8')?.unread).toBe(2)
    expect(inbox.read('8', { timestamp: now, messageIds: ['first', 'same-time'] })).toBe(false)
    expect(inbox.conversations.get('8')?.unread).toBe(1)
    expect(inbox.read('8', { timestamp: now + 1, messageIds: ['later'] })).toBe(true)
    expect(inbox.conversations.get('8')?.unread).toBe(0)
  })

  it('clears older timestamps but never guesses equal-time fallback IDs or another peer', () => {
    const inbox = new PrivateBubbleInbox(() => now)
    inbox.receive(notice('older', now - 1), '9')
    inbox.receive(notice('unknown-id'), '9')
    inbox.receive(notice('other-peer', now, '7'), '9')
    const boundary = privateReadBoundary(
      [{ id: 'fallback:8:9:time:text', time: now, senderId: '8' }],
      '9',
    )
    expect(inbox.read('8', boundary)).toBe(false)
    expect(inbox.conversations.get('8')?.unread).toBe(1)
    expect(inbox.conversations.get('7')?.unread).toBe(1)
  })

  it('keeps deduplication after acknowledgement and bounds pending unread metadata', () => {
    const inbox = new PrivateBubbleInbox(() => now)
    const first = notice('first')
    inbox.receive(first, '9')
    inbox.read('8', { timestamp: now, messageIds: ['first'] })
    expect(inbox.receive(first, '9')).toBeNull()
    expect(inbox.conversations.get('8')?.unread).toBe(0)
    for (let i = 0; i < 1050; i++) inbox.receive(notice(String(i), now + i + 1), '9')
    expect(inbox.conversations.get('8')?.unread).toBe(999)
    expect(inbox.read('8', { timestamp: now + 1050, messageIds: ['1049'] })).toBe(true)
  })

  it('drops unread metadata when its bubble is closed or the account resets', () => {
    const inbox = new PrivateBubbleInbox(() => now)
    inbox.receive(notice('first'), '9')
    inbox.conversations.delete('8')
    inbox.receive(notice('after-close'), '9')
    expect(inbox.conversations.get('8')?.unread).toBe(1)
    inbox.reset()
    expect(inbox.conversations.size).toBe(0)
    inbox.receive(notice('first'), '9')
    expect(inbox.conversations.get('8')?.unread).toBe(1)
  })

  it('publishes the captured read boundary only to the same controller scope', () => {
    const controller = {} as PartyController,
      other = {} as PartyController,
      listener = vi.fn(),
      unrelated = vi.fn()
    const stop = subscribePrivateRead(controller, listener)
    const stopOther = subscribePrivateRead(other, unrelated)
    const boundary = { timestamp: now, messageIds: ['first'] }
    publishPrivateRead(controller, '8', boundary)
    expect(listener).toHaveBeenCalledWith('8', boundary)
    expect(unrelated).not.toHaveBeenCalled()
    stop()
    stopOther()
    publishPrivateRead(controller, '8', boundary)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('keeps all retained editors reachable while evicting older unpinned conversations', () => {
    const inbox = new PrivateBubbleInbox(() => now)
    const pinned = new Set(['10', '11', '12', '13', '14'])
    for (let peer = 10; peer < 100; peer++)
      inbox.receive(notice(`message-${peer}`, now, String(peer)), '9', pinned)
    expect(inbox.conversations.size).toBe(64)
    for (const uid of pinned) expect(inbox.conversations.has(uid)).toBe(true)
    expect(inbox.conversations.has('15')).toBe(false)
    expect(inbox.conversations.has('99')).toBe(true)
    expect(inbox.conversations.get('10')?.unread).toBe(1)

    // Closing an editor releases its protection on the next incoming message.
    pinned.delete('10')
    inbox.receive(notice('after-close', now, '100'), '9', pinned)
    expect(inbox.conversations.size).toBe(64)
    expect(inbox.conversations.has('10')).toBe(false)
    expect(inbox.conversations.has('11')).toBe(true)
  })

  it('retains the hard limit even if a caller supplies too many pinned peers', () => {
    const inbox = new PrivateBubbleInbox(() => now)
    const pins = Array.from({ length: 90 }, (_, i) => String(i + 10))
    for (const uid of pins) inbox.receive(notice(uid, now, uid), '9', pins)
    expect(inbox.conversations.size).toBe(64)
    for (const uid of pins.slice(0, 5)) expect(inbox.conversations.has(uid)).toBe(true)
    expect(inbox.conversations.has('99')).toBe(true)
  })
})
