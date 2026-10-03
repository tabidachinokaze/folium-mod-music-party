import { shouldAccept, targetPosition } from '@party/shared/multiplayer'
import type { RoomPlayback } from '@party/shared/types'
import type { ExternalPlayback, Folium, Intent, Lease, HostSong, FavoriteChange } from './host'
import type { FoliumPlaybackQueue } from '../../vendor/folium/contract'

import { t } from './i18n'

// src/client/player.ts
// Server snapshots only move the local player; they never issue a room mutation.
export class RoomPlayer {
  private lease: Lease | null = null
  metadata: HostSong | null = null
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
  auditioning = false
  private auditionListening = true
  private metadataEpoch = 0
  private stopState: () => void
  constructor(
    private folium: Folium,
    private bridge: ExternalPlayback,
    private now = () => performance.now(),
    private report = (_message: string) => {},
    private metadataChanged = () => {},
    private auditionChanged = (_active: boolean) => {},
  ) {
    this.stopState = folium.events.on('playback.stateChanged', ({ state }) => {
      if (!this.lease || this.suppressPause || this.aligning) return
      if (this.auditioning) {
        if (state === 'paused') this.auditionListening = false
        if (state === 'playing') this.auditionListening = true
        return
      }
      if (state === 'paused') this.listening = false
      if (state === 'playing') {
        this.listening = true
        this.align(true)
      }
    })
  }
  start(
    onIntent: (event: Intent) => void,
    onFavoriteChanged?: (event: FavoriteChange) => Promise<void>,
  ) {
    if (this.lease) return
    try {
      this.lease = this.bridge.acquire({
        onIntent,
        restore: 'queue-stopped',
        audition: true,
        ...(this.bridge.supportsFavoriteEvents ? { onFavoriteChanged } : {}),
      })
    } catch (error: any) {
      const messages: Record<string, string> = {
        'external-playback-context-unavailable': t(
          '请先退出私人 FM/Stage，结束视频录制或等待混音过渡结束，再加入房间',
        ),
        'external-playback-busy': t('其他模组正在控制播放，请先结束其会话'),
      }
      throw new Error(messages[error.message] || error.message)
    }
    this.listening = true
    this.loaded = this.desired = this.endedKey = ''
  }
  setQueue(queue: FoliumPlaybackQueue) {
    this.lease?.setQueue(queue)
  }
  ended() {
    this.endedKey = this.loaded
  }
  align(force = false) {
    if (
      !this.lease ||
      this.auditioning ||
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
    if (this.auditioning) {
      // Keep the room current while listening locally; only an explicit return changes the source.
      void this.refreshMetadata(next)
      return
    }
    const key = next.song ? `${next.song.songId}:${next.song.songBizId}` : ''
    if (!key) {
      this.epoch++
      this.lease.stop()
      this.metadata = null
      this.metadataChanged()
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
      this.metadata = song
      this.metadataChanged()
      const result = await lease.play(song)
      if (epoch !== this.epoch || result.status === 'cancelled' || result.status === 'superseded')
        return
      if (result.status !== 'source-committed')
        throw new Error(
          result.status === 'unavailable'
            ? t('当前歌曲不可用，请等待下一首或重新同步')
            : t('房间歌曲加载失败，请重新同步'),
        )
      // Folia loads metadata separately from its lyric fetch. Wait without advancing the room.
      await this.waitForSource(song, epoch, t('房间歌曲加载超时，请重新同步'))
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
      if (epoch === this.epoch) this.report(error instanceof Error ? error.message : t('播放失败'))
    } finally {
      if (epoch === this.epoch) {
        this.applying = false
        this.task = null
        this.desired = ''
      }
    }
  }
  private async waitForSource(song: HostSong, epoch: number, timeoutMessage: string) {
    const deadline = this.now() + 20000
    while (epoch === this.epoch) {
      const state = this.folium.playback.getState()
      if (state.song?.id === song.id && state.song.source === song.source && state.duration > 0)
        return
      if (this.now() >= deadline) throw new Error(timeoutMessage)
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
  }
  private async refreshMetadata(next: RoomPlayback) {
    const id = next.song?.songId
    if (this.metadata?.id === id) return
    const epoch = ++this.metadataEpoch
    try {
      const song = id ? await this.bridge.resolveSong('netease', id) : null
      if (epoch !== this.metadataEpoch || !this.lease || this.snapshot?.song?.songId !== id) return
      this.metadata = song
      this.metadataChanged()
    } catch {
      // Metadata failure must not interrupt the separately loaded audition.
    }
  }
  async audition(song: HostSong) {
    const lease = this.lease
    if (!lease) return
    const epoch = ++this.epoch
    this.auditioning = true
    this.auditionListening = true
    this.loaded = this.desired = this.endedKey = ''
    this.task = null
    this.applying = true
    this.auditionChanged(true)
    this.pauseInternally()
    try {
      const result = await lease.play(song)
      if (epoch !== this.epoch) return
      if (result.status === 'cancelled' || result.status === 'superseded') {
        await this.returnToRoom()
        return
      }
      if (result.status !== 'source-committed')
        throw new Error(t('试听歌曲暂时无法播放，已返回房间。'))
      await this.waitForSource(song, epoch, t('试听歌曲加载超时，已返回房间。'))
      if (epoch !== this.epoch) return
      this.applying = false
      if (this.auditionListening) this.folium.playback.play()
      else this.pauseInternally()
    } catch (error) {
      if (epoch !== this.epoch) return
      this.report(error instanceof Error ? error.message : t('试听播放失败，已返回房间。'))
      await this.returnToRoom()
    } finally {
      if (epoch === this.epoch) this.applying = false
    }
  }
  seekAudition(seconds: number, resume: boolean) {
    if (!this.auditioning || !this.lease || this.applying || !Number.isFinite(seconds)) return
    const duration = this.folium.playback.getState().duration
    this.lease.seek(Math.max(0, Math.min(seconds, Math.max(0, duration - 0.1))))
    if (resume) this.folium.playback.play()
  }
  async returnToRoom() {
    if (!this.auditioning || !this.lease) return
    ++this.epoch
    // Cancel even an unfinished host load before resolving the room song again.
    // The lease remains owned, so the room queue and pre-audition listening preference survive.
    this.lease.stop()
    this.auditioning = false
    this.loaded = this.desired = this.endedKey = ''
    this.applying = false
    this.auditionChanged(false)
    if (this.snapshot && !this.suspended) await this.apply(this.snapshot)
    else this.pauseInternally()
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
    if (!this.auditioning) this.pauseInternally()
  }
  stop(continuePlayback = false) {
    this.epoch++
    this.metadataEpoch++
    if (continuePlayback && this.lease?.handoff) this.lease.handoff()
    else this.lease?.release()
    this.lease = null
    this.snapshot = null
    this.metadata = null
    this.loaded = this.desired = ''
    this.task = null
    this.applying = false
    if (this.auditioning) {
      this.auditioning = false
      this.auditionChanged(false)
    }
  }
  dispose() {
    this.stop()
    this.stopState()
  }
}
