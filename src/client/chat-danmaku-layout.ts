import type { ChatMessage } from '@party/shared/types'
import type { DanmakuPreferenceValues } from './chat-preferences'

export function danmakuGeometry(
  width: number,
  height: number,
  options: DanmakuPreferenceValues,
  reducedMotion = false,
) {
  const fontSize = (17 * options.danmakuFontSize) / 100,
    imageSize = 40 * Math.min(1.2, options.danmakuFontSize / 100),
    lineHeight = Math.ceil(Math.max(fontSize * 1.4, options.danmakuMedia ? imageSize : 0) + 10),
    available = Math.max(0, ((height - 48) * options.danmakuArea) / 100),
    rows = Math.max(0, Math.floor((available - 1) / lineHeight)),
    duration = reducedMotion ? 5 : 9 / (options.danmakuSpeed / 100)
  return {
    fontSize,
    imageSize,
    lineHeight,
    rows,
    // The library wraps a scrolling row modulo stageHeight - rowHeight. The
    // extra pixel keeps a completely filled final row inside the allotted area.
    height: rows ? rows * lineHeight + 1 : 0,
    speed: width > 0 ? width / duration : 1,
    duration,
  }
}

export function danmakuCategory(message: ChatMessage): 'text' | 'media' | 'activity' {
  if (
    message.emoji ||
    message.kind === 'image' ||
    message.attachments?.some((item) => item.kind === 'image')
  )
    return 'media'
  return message.kind === 'text' ? 'text' : 'activity'
}

export class DanmakuFilter {
  private seen = new Map<string, number>()

  take(messages: readonly ChatMessage[], options: DanmakuPreferenceValues, now: number) {
    for (const [key, at] of this.seen) if (now - at > 15000) this.seen.delete(key)
    return messages.filter((message) => {
      const category = danmakuCategory(message)
      if (
        (category === 'text' && !options.danmakuText) ||
        (category === 'media' && !options.danmakuMedia) ||
        (category === 'activity' && !options.danmakuActivity)
      )
        return false
      if (!options.danmakuDedupe) return true
      const key = JSON.stringify([
        category,
        message.text.trim().replace(/\s+/gu, ' '),
        message.emoji?.emojiImgUrl,
        message.attachments?.map((item) => [item.kind, item.resourceId, item.url, item.title]),
      ])
      if (this.seen.has(key)) return false
      this.seen.set(key, now)
      if (this.seen.size > 200) this.seen.delete(this.seen.keys().next().value!)
      return true
    })
  }

  clear() {
    this.seen.clear()
  }
}

export class DanmakuTracks {
  private entries = new Map<string, number>()
  private next = 0

  constructor(private count: number) {}

  claim(id: string, overlap: boolean): number | null {
    if (!this.count || this.entries.size >= 40) return null
    if (this.entries.has(id)) return this.entries.get(id)!
    const occupied = new Set(this.entries.values())
    for (let offset = 0; offset < this.count; offset++) {
      const lane = (this.next + offset) % this.count
      if (!overlap && occupied.has(lane)) continue
      this.entries.set(id, lane)
      this.next = (lane + 1) % this.count
      return lane
    }
    return null
  }

  release(id: string) {
    this.entries.delete(id)
  }
}

export class DanmakuQueue<T> {
  private items: { value: T; at: number }[] = []

  constructor(
    private capacity = 40,
    private lifetime = 12000,
  ) {}

  push(values: readonly T[], now: number) {
    this.items.push(...values.map((value) => ({ value, at: now })))
    this.items = this.items.slice(-this.capacity)
  }

  peek(now: number): T | undefined {
    while (this.items.length && now - this.items[0].at > this.lifetime) this.items.shift()
    return this.items[0]?.value
  }

  shift() {
    this.items.shift()
  }

  clear() {
    this.items = []
  }
}
