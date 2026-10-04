import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrivateRefresh } from '../src/client/private-refresh'

// tests/private-refresh.test.ts
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(refresh = vi.fn(async () => {})) {
  const doc = new EventTarget(),
    win = new EventTarget(),
    onError = vi.fn()
  let active = true
  const task = createPrivateRefresh({
    active: () => active,
    refresh,
    onError,
    document: doc,
    window: win,
  })
  return { ...task, refresh, onError, doc, win, active: (value: boolean) => (active = value) }
}
function pending() {
  let resolve!: () => void, reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('active private-page refresh', () => {
  it('coalesces background notifications, keeps hidden pages dirty and refreshes only after visibility returns', async () => {
    const task = setup()
    task.start()
    for (let index = 0; index < 10; index++) task.invalidate()
    await vi.advanceTimersByTimeAsync(0)
    expect(task.refresh).toHaveBeenCalledOnce()
    task.active(false)
    for (let index = 0; index < 10; index++) task.invalidate()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(task.refresh).toHaveBeenCalledOnce()
    task.active(true)
    task.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(task.refresh).toHaveBeenCalledTimes(2)
    task.dispose()
  })
  it('retains an invalidation during an in-flight refresh and retries a busy composer without overlap', async () => {
    const first = pending(),
      refresh = vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(undefined),
      task = setup(refresh)
    task.start()
    task.invalidate()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(300)
    task.invalidate()
    first.resolve()
    await vi.advanceTimersByTimeAsync(699)
    expect(refresh).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(refresh).toHaveBeenCalledTimes(4)
    task.dispose()
  })
  it('polls every ten seconds, skips hidden pages and refreshes when visible or focused again', async () => {
    const task = setup()
    task.start()
    await vi.advanceTimersByTimeAsync(9999)
    expect(task.refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(task.refresh).toHaveBeenCalledTimes(1)
    task.active(false)
    await vi.advanceTimersByTimeAsync(30_000)
    task.win.dispatchEvent(new Event('focus'))
    expect(task.refresh).toHaveBeenCalledTimes(1)
    task.active(true)
    task.doc.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(task.refresh).toHaveBeenCalledTimes(2)
    task.dispose()
  })
  it('coalesces focus/visibility/network signals, never overlaps a slow refresh, and resumes afterwards', async () => {
    const first = pending(),
      task = setup(vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined))
    task.start()
    await vi.advanceTimersByTimeAsync(10_000)
    for (let index = 0; index < 5; index++) {
      task.win.dispatchEvent(new Event('focus'))
      task.win.dispatchEvent(new Event('online'))
      task.doc.dispatchEvent(new Event('visibilitychange'))
    }
    await vi.advanceTimersByTimeAsync(30_000)
    expect(task.refresh).toHaveBeenCalledTimes(1)
    first.resolve()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(task.refresh).toHaveBeenCalledTimes(2)
    task.dispose()
  })
  it('backs off failed refreshes to at most a minute and resets after success', async () => {
    const failure = new Error('offline'),
      task = setup(vi.fn().mockRejectedValue(failure))
    task.start()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(task.onError).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(19_999)
    expect(task.refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(task.refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(task.refresh).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(task.refresh).toHaveBeenCalledTimes(4)
    task.refresh.mockResolvedValue(undefined)
    task.win.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(task.refresh).toHaveBeenCalledTimes(5)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(task.refresh).toHaveBeenCalledTimes(6)
    task.dispose()
  })
  it('does not apply an old account failure to a replacement account or inherit its backoff', async () => {
    const first = pending(),
      task = setup(vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined))
    task.start()
    await vi.advanceTimersByTimeAsync(10_000)
    task.stop()
    task.start()
    first.reject(new Error('old account request'))
    await vi.advanceTimersByTimeAsync(0)
    expect(task.onError).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(task.refresh).toHaveBeenCalledTimes(2)
    task.dispose()
  })
  it('removes timers and event listeners on disposal, even when a request is still pending', async () => {
    const first = pending(),
      task = setup(vi.fn(() => first.promise))
    task.start()
    await vi.advanceTimersByTimeAsync(10_000)
    task.dispose()
    first.reject(new Error('disposed'))
    task.doc.dispatchEvent(new Event('visibilitychange'))
    task.win.dispatchEvent(new Event('focus'))
    task.win.dispatchEvent(new Event('online'))
    task.start()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(task.refresh).toHaveBeenCalledOnce()
    expect(task.onError).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
