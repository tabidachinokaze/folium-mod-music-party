import { randomUUID } from 'node:crypto'
import { MiniNotifications, type MiniNotificationOptions } from './mini-notifications'
import { parsePrivateNotice } from './private-notice'
import type {
  PrivateNotice,
  PrivateNotificationBatch,
  PrivateNotificationEvent,
} from '../shared/private-notices'

// src/main/shared-notifications.ts
type Transport = Pick<MiniNotifications, 'open' | 'poll' | 'close'>
export type NotificationFactory = (options: MiniNotificationOptions) => Transport
type Matching = { id: string; created: number; touched: number; error?: string }
const EVENT_LIMIT = 256
const SEEN_LIMIT = 1024

/** Account-scoped transport. A matching attempt and background inbox share one mini login. */
export class SharedNotifications {
  private session = randomUUID()
  private selfUid = ''
  private ended = false
  private transport: Transport | null = null
  private opening: Promise<void> | null = null
  private connected = false
  private reconnect: ReturnType<typeof setTimeout> | null = null
  private backoff = 1000
  private matching: Matching | null = null
  private matchTimer: ReturnType<typeof setInterval> | null = null
  private sequence = 0
  private events: PrivateNotificationEvent[] = []
  private seen = new Set<string>()

  constructor(
    private readonly credentials: () => Promise<{ accId: string; token: string }>,
    private readonly make: NotificationFactory = (options) => new MiniNotifications(options),
  ) {}

  enablePrivate(uid: string) {
    if (this.ended || !/^[1-9]\d{0,23}$/.test(uid)) return
    if (this.selfUid && this.selfUid !== uid) {
      this.matchClose()
      this.stopConnection()
      this.session = randomUUID()
      this.sequence = 0
      this.events = []
      this.seen.clear()
    }
    const first = !this.selfUid || this.selfUid !== uid
    this.selfUid = uid
    if (first && this.connected) this.sync()
    // Repeated account queries must not bypass an in-progress retry backoff.
    if (!this.reconnect) void this.ensureConnection().catch(() => {})
  }

  async matchOpen(id: string): Promise<void> {
    this.matchClose()
    if (this.ended) throw new Error('匹配通知连接已关闭')
    // Discard notices received before this attempt without affecting the inbox feed.
    if (this.connected) this.transport?.poll()
    const active: Matching = { id, created: Date.now(), touched: Date.now() }
    this.matching = active
    this.matchTimer = setInterval(() => {
      if (this.matching !== active || active.error) return
      const now = Date.now()
      if (now - active.created > 150000 || now - active.touched > 20000) {
        active.error =
          now - active.created > 150000 ? '匹配通知连接已到期，请重试' : '匹配页面已关闭'
        this.clearMatchTimer()
        if (!this.selfUid) this.stopConnection()
      }
    }, 10000)
    this.matchTimer.unref()
    try {
      await this.ensureConnection()
      if (this.matching !== active || this.ended) throw new Error('匹配已取消')
      if (active.error) throw new Error(active.error)
    } catch (error) {
      if (this.matching === active) this.matchClose(id)
      throw error
    }
  }

  matchPoll(id: string) {
    if (!this.matching || this.matching.id !== id) throw new Error('匹配通知连接已关闭')
    if (this.matching.error) throw new Error(this.matching.error)
    if (!this.connected || !this.transport) throw new Error('匹配通知连接已断开，请重试')
    this.matching.touched = Date.now()
    return this.transport.poll()
  }

  matchClose(id?: string) {
    if (!this.matching || (id && this.matching.id !== id)) return
    this.matching = null
    this.clearMatchTimer()
    if (!this.selfUid) this.stopConnection()
  }

  poll(cursor: number, session?: string): PrivateNotificationBatch {
    if (
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      (session !== undefined && (typeof session !== 'string' || session.length > 64))
    )
      throw new Error('通知游标无效')
    const oldest = this.events[0]?.sequence ?? this.sequence + 1
    const reset =
      (!!session && session !== this.session) || cursor > this.sequence || cursor < oldest - 1
    return {
      session: this.session,
      cursor: this.sequence,
      connected: !!this.selfUid && this.connected,
      reset,
      events: this.events.filter((event) => reset || !session || event.sequence > cursor),
    }
  }

  close() {
    if (this.ended) return
    this.ended = true
    this.selfUid = ''
    this.matchClose()
    this.stopConnection()
    this.events = []
    this.seen.clear()
  }

  private clearMatchTimer() {
    if (this.matchTimer) clearInterval(this.matchTimer)
    this.matchTimer = null
  }

  private sync() {
    this.append({ kind: 'sync', id: randomUUID(), timestamp: Date.now() })
  }

  private append(notice: PrivateNotice) {
    this.events.push({ sequence: ++this.sequence, notice })
    if (this.events.length > EVENT_LIMIT) this.events.shift()
  }

  private stopConnection() {
    if (this.reconnect) clearTimeout(this.reconnect)
    this.reconnect = null
    const transport = this.transport
    this.transport = null
    this.opening = null
    this.connected = false
    transport?.close()
  }

  private lost(transport: Transport, reason: string) {
    if (this.transport !== transport) return
    this.transport = null
    this.opening = null
    this.connected = false
    transport.close()
    // A reconnected inbox must not silently revive a matching ACK from the old attempt.
    if (this.matching) {
      this.matching.error = reason
      this.clearMatchTimer()
    }
    if (this.ended || !this.selfUid || this.reconnect) return
    const delay = this.backoff
    this.backoff = Math.min(60000, this.backoff * 2)
    this.reconnect = setTimeout(() => {
      this.reconnect = null
      void this.ensureConnection().catch(() => {})
    }, delay)
    this.reconnect.unref()
  }

  private ensureConnection(): Promise<void> {
    if (this.ended || (!this.selfUid && !this.matching))
      return Promise.reject(new Error('匹配已取消'))
    if (this.connected) return Promise.resolve()
    if (this.opening) return this.opening
    if (this.reconnect) clearTimeout(this.reconnect)
    this.reconnect = null
    const transport = this.make({
      persistent: true,
      onNotification: (content, timestamp) => {
        if (this.transport !== transport || !this.selfUid || this.ended) return
        const notice = parsePrivateNotice(content, timestamp, this.selfUid)
        if (!notice || this.seen.has(notice.id)) return
        this.seen.add(notice.id)
        if (this.seen.size > SEEN_LIMIT) this.seen.delete(this.seen.values().next().value!)
        this.append(notice)
      },
      onClose: (reason) => this.lost(transport, reason),
    })
    this.transport = transport
    let credentials: Promise<{ accId: string; token: string }>
    try {
      credentials = this.credentials()
    } catch (error) {
      credentials = Promise.reject(error)
    }
    let task!: Promise<void>
    task = (async () => {
      try {
        const value = await credentials
        if (this.transport !== transport || this.ended) throw new Error('匹配已取消')
        await transport.open(value)
        if (this.transport !== transport || this.ended) throw new Error('匹配已取消')
        this.connected = true
        this.backoff = 1000
        if (this.selfUid) this.sync()
      } catch (error) {
        this.lost(transport, error instanceof Error ? error.message : '网易云通知连接失败')
        throw error
      } finally {
        if (this.opening === task) this.opening = null
      }
    })()
    this.opening = task
    return task
  }
}
