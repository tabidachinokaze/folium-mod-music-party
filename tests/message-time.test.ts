import { expect, it } from 'vitest'
import { formatMessageTime } from '../src/client/message-time'

// tests/message-time.test.ts
const now = new Date(2026, 9, 2, 9, 5).getTime()
it('shows just a 24-hour clock for messages from today', () => {
  expect(formatMessageTime(new Date(2026, 9, 2, 3, 4).getTime(), now).text).toBe('03:04')
})
it('adds the local calendar date to yesterday and older messages, even across midnight', () => {
  expect(formatMessageTime(new Date(2026, 9, 1, 23, 59).getTime(), now).text).toBe('10-01 23:59')
  expect(formatMessageTime(new Date(2026, 0, 2, 0, 1).getTime(), now).text).toBe('01-02 00:01')
})
it('keeps the year for messages from another year and exposes the full timestamp', () => {
  const timestamp = new Date(2025, 11, 31, 12, 34).getTime()
  expect(formatMessageTime(timestamp, now)).toMatchObject({
    text: '2025-12-31 12:34',
    dateTime: new Date(timestamp).toISOString(),
  })
  expect(formatMessageTime(timestamp, now).title).not.toBe('')
})
it('does not show Invalid Date for missing server timestamps', () => {
  expect(formatMessageTime(NaN, now)).toEqual({ text: '', title: '', dateTime: '' })
})
