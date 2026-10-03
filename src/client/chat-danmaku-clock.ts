// Danmaku's documented media adapter consumes an event target, currentTime,
// paused and playbackRate. This clock is independent of the player's music:
// hovering must pause comments without pausing the song or seeking room history.
export class DanmakuClock extends EventTarget {
  readonly playbackRate = 1
  private elapsed = 0
  private started = 0
  paused = true

  constructor(private now = () => performance.now()) {
    super()
  }

  get currentTime() {
    return (this.elapsed + (this.paused ? 0 : this.now() - this.started)) / 1000
  }

  play() {
    if (!this.paused) return
    this.started = this.now()
    this.paused = false
    this.dispatchEvent(new Event('play'))
  }

  pause() {
    if (this.paused) return
    this.elapsed += this.now() - this.started
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}
