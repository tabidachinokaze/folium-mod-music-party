import type { PrivateNotice, PrivateNotificationBatch } from '../shared/private-notices'

// src/client/private-notifications.ts
// Reads the main process's local event queue. The main process owns the IM
// connection; this service never fetches conversations, history or read receipts.
export const PRIVATE_NOTIFICATION_INTERVAL = 1000
const SEEN_LIMIT = 512

export class PrivateNotifications {
  private account = ''
  private epoch = 0
  private disposed = false
  private cursor = 0
  private session = ''
  private failures = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private seen = new Set<string>()
  private listeners = new Set<(event: PrivateNotice) => void>()

  constructor(
    private transport: {
      privateNotificationsPoll(cursor: number, session?: string): Promise<PrivateNotificationBatch>
    },
    private onAccountError: (error: { code?: number }) => void,
  ) {}

  subscribe(listener: (event: PrivateNotice) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setAccount(uid: string | null) {
    const next = uid || ''
    if (this.disposed || next === this.account) return
    this.stop()
    this.account = next
    if (next) this.schedule(0, this.epoch)
  }

  stop() {
    this.epoch++
    this.account = ''
    this.cursor = 0
    this.session = ''
    this.failures = 0
    this.seen.clear()
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private schedule(delay: number, epoch: number) {
    if (this.disposed || !this.account || epoch !== this.epoch) return
    this.timer = setTimeout(() => void this.poll(epoch), delay)
  }

  private emit(notice: PrivateNotice, epoch: number) {
    const key = `${notice.kind}:${notice.id}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value!)
    for (const listener of this.listeners) {
      if (this.disposed || epoch !== this.epoch) break
      // An individual view must not prevent other consumers from receiving events.
      try {
        listener(notice)
      } catch {}
    }
  }

  private async poll(epoch: number) {
    if (this.disposed || !this.account || epoch !== this.epoch) return
    this.timer = undefined
    try {
      const batch = await this.transport.privateNotificationsPoll(this.cursor, this.session)
      if (this.disposed || epoch !== this.epoch) return
      const replaced = this.session !== batch.session
      if (replaced) this.seen.clear()
      this.session = batch.session
      const previous = replaced || batch.reset ? 0 : this.cursor
      const events = batch.events.filter((event) => event.sequence > previous)
      this.cursor = Math.max(replaced || batch.reset ? 0 : this.cursor, batch.cursor)
      this.failures = 0
      // A queue gap/replaced main session requires a fresh HTTP snapshot in a
      // visible view, even when the retained tail contains no explicit sync.
      if ((batch.reset || replaced) && !events.some((event) => event.notice.kind === 'sync'))
        this.emit(
          { kind: 'sync', id: `reset:${batch.session}:${batch.cursor}`, timestamp: Date.now() },
          epoch,
        )
      for (const event of events) {
        if (this.disposed || epoch !== this.epoch) return
        this.emit(event.notice, epoch)
      }
    } catch (error) {
      if (this.disposed || epoch !== this.epoch) return
      const code = (error as { code?: number } | null)?.code
      if (code === 301 || code === 302) {
        this.stop()
        this.onAccountError({ code })
        return
      }
      this.failures = Math.min(this.failures + 1, 5)
    }
    this.schedule(Math.min(30_000, PRIVATE_NOTIFICATION_INTERVAL * 2 ** this.failures), epoch)
  }

  dispose() {
    this.stop()
    this.disposed = true
    this.listeners.clear()
  }
}
