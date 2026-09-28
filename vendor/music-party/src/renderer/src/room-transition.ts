import type { RoomPlayback } from '../../shared/types'

// At a track boundary, confirm the server's next business item rather than sending SWITCH.
export class RoomTransition {
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private running = false
  private key = ''
  private attempts = 0
  private endedKey = ''
  constructor(
    private state: () => RoomPlayback | null,
    private refresh: () => Promise<void>,
    private now = () => performance.now(),
  ) {}
  changed() {
    if (this.stopped || this.running) return
    clearTimeout(this.timer)
    const state = this.state()
    if (!state) return
    if (!state.song) {
      if (this.key)
        this.timer = setTimeout(
          () => this.check(),
          [750, 1500, 2500, 4000, 5000][Math.min(this.attempts, 4)],
        )
      return
    }
    const key = state.song.songBizId
    if (key !== this.key) {
      this.key = key
      this.attempts = 0
    }
    if (!state.duration && this.endedKey !== key) return
    const remaining = state.duration - state.playedTime - Math.max(0, this.now() - state.sampledAt)
    const delay =
      this.endedKey === key || remaining <= 0
        ? [100, 750, 1500, 2500, 4000, 5000][Math.min(this.attempts, 5)]
        : Math.max(100, remaining + 80)
    this.timer = setTimeout(() => this.check(), delay)
  }
  ended() {
    this.endedKey = this.state()?.song?.songBizId || ''
    this.changed()
  }
  private async check() {
    if (this.stopped) return
    this.running = true
    try {
      await this.refresh()
    } catch {
      /* The normal sync path presents connection errors; keep retrying with a bounded rate. */
    } finally {
      this.running = false
      this.attempts++
      this.changed()
    }
  }
  pause() {
    this.stopped = true
    clearTimeout(this.timer)
  }
  resume() {
    this.stopped = false
    this.attempts = 0
    this.changed()
  }
}
