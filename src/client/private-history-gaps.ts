import type { PrivateMessage, PrivatePage } from '@party/shared/types'

// src/client/private-history-gaps.ts
/** Retain missing ranges when more than one server page arrives between foreground refreshes. */
export class PrivateHistoryGaps {
  private ranges: { after: number; before: number }[] = []

  observe(previous: PrivateMessage[], latest: PrivatePage) {
    const newest = Math.max(0, ...previous.map((message) => message.time))
    if (!newest || !latest.more || latest.before === null || latest.before <= newest) return
    this.ranges.push({ after: newest, before: latest.before })
    this.ranges.sort((a, b) => a.after - b.after)
    const merged: typeof this.ranges = []
    for (const range of this.ranges) {
      const last = merged.at(-1)
      if (last && range.after <= last.before) last.before = Math.max(last.before, range.before)
      else merged.push({ ...range })
    }
    this.ranges = merged
  }

  next(): number | null {
    return this.ranges[0]?.before ?? null
  }

  accept(cursor: number, page: PrivatePage) {
    const range = this.ranges.find((item) => item.before === cursor)
    if (!range) return
    if (page.before !== null && page.before >= cursor) throw new Error('私信分页响应未向前推进')
    if (!page.more || page.before === null || page.before <= range.after)
      this.ranges = this.ranges.filter((item) => item !== range)
    else range.before = page.before
  }

  clear() {
    this.ranges = []
  }
}
