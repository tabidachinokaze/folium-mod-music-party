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

  // Preserve the playback state while rebasing one comment's elapsed time.
  // Public media pause/play events make Danmaku update its wall-clock baseline.
  retime(seconds: number) {
    const playing = !this.paused
    this.pause()
    this.elapsed = Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 1000
    if (playing) this.play()
  }
}

export function danmakuElapsedAtX(
  x: number,
  width: number,
  commentWidth: number,
  duration: number,
) {
  const progress = (width - x) / Math.max(1, width + commentWidth)
  return Math.max(0, Math.min(1, progress)) * duration
}
