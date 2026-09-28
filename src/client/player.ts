import { shouldAccept, targetPosition } from '@party/shared/multiplayer'
import type { RoomPlayback } from '@party/shared/types'
import type { ExternalPlayback, Folium, Intent, Lease } from './host'

// src/client/player.ts
// Server snapshots only move the local player; they never issue a room mutation.
export class RoomPlayer {
  private lease: Lease | null = null
  private epoch = 0
  private snapshot: RoomPlayback | null = null
  private desired = ''
  private loaded = ''
  private endedKey = ''
  private task: Promise<void> | null = null
  private listening = true
  private suspended = false
  private applying = false
  private aligning = false
  private suppressPause = false
  private stopState: () => void
  constructor(
    private folium: Folium,
    private bridge: ExternalPlayback,
    private now = () => performance.now(),
    private report = (_message: string) => {},
  ) {
    this.stopState = folium.events.on('playback.stateChanged', ({ state }) => {
      if (!this.lease || this.suppressPause || this.aligning) return
      if (state === 'paused') this.listening = false
      if (state === 'playing') {
        this.listening = true
        this.align(true)
      }
    })
  }
  start(onIntent: (event: Intent) => void) {
    if (this.lease) return
    this.lease = this.bridge.acquire(onIntent)
    this.listening = true
    this.loaded = this.desired = this.endedKey = ''
  }
  ended() {
    this.endedKey = this.loaded
  }
  align(force = false) {
    if (
      !this.lease ||
      !this.snapshot?.song ||
      !this.listening ||
      this.suspended ||
      this.applying ||
      this.aligning ||
      this.loaded === this.endedKey
    )
      return
    const state = this.folium.playback.getState()
    if (
      state.song?.source !== 'netease' ||
      state.song.id !== this.snapshot.song.songId ||
      !state.duration
    )
      return
    const target = Math.min(
      targetPosition(this.snapshot, this.now()) / 1000,
      Math.max(0, state.duration - 0.1),
    )
    if (force || this.snapshot.forceSync || Math.abs(state.position - target) > 1.5) {
      this.aligning = true
      try {
        this.lease.seek(target)
      } finally {
        this.aligning = false
      }
    }
  }
  async apply(next: RoomPlayback) {
    if (!this.lease || !shouldAccept(this.snapshot, next)) return
    this.snapshot = next
    this.suspended = false
    const key = next.song ? `${next.song.songId}:${next.song.songBizId}` : ''
    if (!key) {
      this.epoch++
      this.pauseInternally()
      this.loaded = this.desired = ''
      return
    }
    if (key === this.loaded) {
      this.align()
      if (
        this.listening &&
        this.loaded !== this.endedKey &&
        this.folium.playback.getState().state !== 'playing' &&
        (!next.duration || targetPosition(next, this.now()) < next.duration - 500)
      )
        this.folium.playback.play()
      return
    }
    if (key === this.desired && this.task) return this.task.catch(() => {})
    this.desired = key
    const epoch = ++this.epoch
    const lease = this.lease
    this.pauseInternally()
    this.applying = true
    const task = (async () => {
      const song = await this.bridge.resolveSong('netease', next.song!.songId)
      if (epoch !== this.epoch) return
      if (!(await lease.play(song)) || epoch !== this.epoch) return
      // Folia loads metadata separately from its lyric fetch. Wait without advancing the room.
      const deadline = this.now() + 20000
      while (epoch === this.epoch) {
        const state = this.folium.playback.getState()
        if (state.song?.id === song.id && state.song.source === 'netease' && state.duration > 0)
          break
        if (this.now() >= deadline) throw new Error('房间歌曲加载超时，请重新同步')
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 100)
        })
      }
      if (epoch !== this.epoch) return
      this.loaded = key
      this.endedKey = ''
      this.applying = false
      this.align(true)
      if (this.listening && !this.suspended) this.folium.playback.play()
      else this.pauseInternally()
    })()
    this.task = task
    try {
      await task
    } catch (error) {
      if (epoch === this.epoch) this.report(error instanceof Error ? error.message : '播放失败')
    } finally {
      if (epoch === this.epoch) {
        this.applying = false
        this.task = null
        this.desired = ''
      }
    }
  }
  private pauseInternally() {
    this.suppressPause = true
    try {
      this.folium.playback.pause()
    } finally {
      this.suppressPause = false
    }
  }
  suspend() {
    this.suspended = true
    this.pauseInternally()
  }
  stop() {
    this.epoch++
    this.lease?.release()
    this.lease = null
    this.snapshot = null
    this.loaded = this.desired = ''
    this.task = null
    this.applying = false
  }
  dispose() {
    this.stop()
    this.stopState()
  }
}
