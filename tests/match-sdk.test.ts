import { afterEach, expect, it, vi } from 'vitest'
import { createMatchSdk } from '../src/client/match-sdk'

// tests/match-sdk.test.ts
afterEach(() => vi.useRealTimers())
it('polls only this attempt and closes once without moving credentials through RPC', async () => {
  vi.useFakeTimers()
  const matchTransport = vi.fn(async (name: string, _id: string) =>
    name === 'matchPoll'
      ? [{ timestamp: 99, notice: { kind: 'ready', roomId: 'room' } }]
      : undefined,
  )
  const client = await createMatchSdk({ matchTransport }),
    receive = vi.fn()
  client.onNotification(receive)
  await client.login()
  await vi.advanceTimersByTimeAsync(0)
  expect(receive).toHaveBeenCalledWith({ timestamp: 99, notice: { kind: 'ready', roomId: 'room' } })
  client.close()
  client.close()
  await vi.advanceTimersByTimeAsync(2000)
  expect(matchTransport.mock.calls.map(([name]) => name)).toEqual([
    'matchOpen',
    'matchPoll',
    'matchClose',
  ])
  expect(new Set(matchTransport.mock.calls.map(([, id]) => id)).size).toBe(1)
})
it('ignores a pending poll after cancellation and does not deliver stale notices', async () => {
  let complete!: (value: unknown) => void
  const matchTransport = vi.fn(async (name: string) =>
    name === 'matchPoll'
      ? new Promise((r) => {
          complete = r
        })
      : undefined,
  )
  const client = await createMatchSdk({ matchTransport }),
    receive = vi.fn()
  client.onNotification(receive)
  await client.login()
  client.close()
  complete([{ timestamp: 1, notice: { kind: 'ready', roomId: 'stale' } }])
  await Promise.resolve()
  expect(receive).not.toHaveBeenCalled()
})
