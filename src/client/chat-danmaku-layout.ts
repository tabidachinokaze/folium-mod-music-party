export interface DanmakuSlot {
  lane: number
  duration: number
}

// All scrolling messages use one pixel speed, so a shorter follower cannot catch
// a longer message. A lane opens only once the preceding tail has cleared its entrance.
export class DanmakuLanes {
  private ready: number[]
  private next = 0

  constructor(
    count: number,
    private speed = 90,
    private gap = 36,
  ) {
    this.ready = Array.from({ length: Math.max(0, Math.floor(count)) }, () => 0)
  }

  claim(now: number, width: number, viewport: number, stationary = false): DanmakuSlot | null {
    if (width <= 0 || viewport <= 0) return null
    for (let offset = 0; offset < this.ready.length; offset++) {
      const lane = (this.next + offset) % this.ready.length
      if (this.ready[lane] > now) continue
      const duration = stationary ? 5000 : ((viewport + width) / this.speed) * 1000
      this.ready[lane] = now + (stationary ? duration : ((width + this.gap) / this.speed) * 1000)
      this.next = (lane + 1) % this.ready.length
      return { lane, duration }
    }
    return null
  }

  delay(now: number) {
    return this.ready.length ? Math.max(0, Math.min(...this.ready) - now) : Infinity
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
