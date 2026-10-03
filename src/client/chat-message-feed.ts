import type { ChatMessage } from '@party/shared/types'
import type { PartyState } from './controller'

type ChatState = Pick<PartyState, 'account' | 'room' | 'messages'>

// A time watermark keeps pagination and repeated polling out of live-only surfaces.
// IDs at that watermark remain distinct: different listeners can send in the same millisecond.
export class ChatMessageFeed {
  private scope = ''
  private active = false
  private watermark = -Infinity
  private ids = new Set<string>()
  private awaitingHistory = false
  private previous: readonly ChatMessage[] | null = null

  constructor(private now = () => Date.now()) {}

  take(state: ChatState, active = true): ChatMessage[] {
    const roomId = state.room?.roomId,
      scope = state.account && roomId ? `${state.account.uid}:${roomId}` : '',
      changed = scope !== this.scope || (active && !this.active),
      messages = state.messages.filter((message) => message.roomId === roomId && !message.delivery)
    this.scope = scope
    this.active = active
    if (!scope) {
      this.previous = null
      this.watermark = -Infinity
      this.ids.clear()
      this.awaitingHistory = false
      return []
    }
    if (changed || !this.previous) {
      this.previous = state.messages
      this.awaitingHistory = !messages.length
      this.baseline(messages, this.now())
      return []
    }
    if (this.previous === state.messages) return []
    this.previous = state.messages
    const fresh = messages.filter(
      (message) =>
        Number.isFinite(message.time) &&
        (message.time > this.watermark ||
          (message.time === this.watermark && !this.ids.has(message.id))),
    )
    if (this.awaitingHistory) {
      // The first delayed history response may precede our local clock. Establish the
      // server watermark, but do not discard a first message sent after joining an empty room.
      if (messages.length) {
        this.baseline(messages, this.watermark)
        this.awaitingHistory = false
      }
    } else {
      for (const message of fresh) {
        if (message.time > this.watermark) {
          this.watermark = message.time
          this.ids.clear()
        }
        if (message.time === this.watermark) this.ids.add(message.id)
      }
    }
    return active ? fresh.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)) : []
  }

  private baseline(messages: readonly ChatMessage[], emptyTime: number) {
    this.watermark = messages.reduce(
      (latest, message) =>
        Number.isFinite(message.time) ? Math.max(latest, message.time) : latest,
      -Infinity,
    )
    if (this.watermark === -Infinity) this.watermark = emptyTime
    this.ids = new Set(
      messages.filter((message) => message.time === this.watermark).map((message) => message.id),
    )
  }
}
