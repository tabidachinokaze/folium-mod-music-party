// src/client/private-refresh.ts
export const PRIVATE_REFRESH_INTERVAL = 10_000

/** HTTP refresh stays scoped to the visible page; background IM only invalidates it. */
export function createPrivateRefresh(options: {
  active(): boolean
  /** false means the view is temporarily busy; preserve the invalidation for another tick. */
  refresh(): Promise<void | boolean>
  onError(error: unknown): void
  document?: EventTarget
  window?: EventTarget
}) {
  const doc = options.document ?? document,
    win = options.window ?? window
  let enabled = false,
    disposed = false,
    busy = false,
    epoch = 0,
    failures = 0,
    dirty = false,
    lastStart = -Infinity,
    timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const schedule = (delay: number) => {
    clear()
    if (enabled && !disposed) timer = setTimeout(() => void tick(), delay)
  }
  async function tick() {
    timer = undefined
    if (!enabled || disposed) return
    if (!options.active()) return schedule(PRIVATE_REFRESH_INTERVAL)
    if (busy) return schedule(1000)
    busy = true
    dirty = false
    lastStart = Date.now()
    const current = epoch
    try {
      const result = await options.refresh()
      if (current === epoch) {
        failures = 0
        if (result === false) dirty = true
      }
    } catch (error) {
      if (current === epoch && enabled && !disposed) {
        failures = Math.min(failures + 1, 3)
        options.onError(error)
      }
    } finally {
      busy = false
      // A replaced account keeps its own pending timer and does not inherit the old retry state.
      if (current === epoch)
        schedule(
          dirty && !failures
            ? Math.max(0, 1000 - (Date.now() - lastStart))
            : Math.min(60_000, PRIVATE_REFRESH_INTERVAL * 2 ** failures),
        )
    }
  }
  const wake = () => {
    if (enabled && !disposed && options.active())
      schedule(Math.max(0, 1000 - (Date.now() - lastStart)))
  }
  doc.addEventListener('visibilitychange', wake)
  win.addEventListener('focus', wake)
  win.addEventListener('online', wake)
  return {
    start() {
      if (disposed) return
      enabled = true
      failures = 0
      epoch++
      schedule(dirty ? 0 : PRIVATE_REFRESH_INTERVAL)
    },
    invalidate() {
      if (disposed) return
      dirty = true
      wake()
    },
    resume() {
      if (dirty) wake()
    },
    stop() {
      enabled = false
      dirty = false
      epoch++
      clear()
    },
    dispose() {
      disposed = true
      enabled = false
      epoch++
      clear()
      doc.removeEventListener('visibilitychange', wake)
      win.removeEventListener('focus', wake)
      win.removeEventListener('online', wake)
    },
  }
}
