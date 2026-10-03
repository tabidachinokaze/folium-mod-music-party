import { RoomMatch } from './room-match'
import { nativeQueue } from './native-queue'
import {
  heartbeatInterval,
  parseRoomPlayback,
  parseSnapshot,
  shouldAccept,
} from '@party/shared/multiplayer'
import { mergeChat } from '@party/shared/chat'
import { invitation, parseInvitation } from '@party/shared/protocol'
import { RoomTransition } from '@party/renderer/src/room-transition'
import type { ChatMessage, RoomQueueEntry, RoomSnapshot } from '@party/shared/types'
import {
  AccountConnection,
  getPlaybackBridge,
  type Folium,
  type HostSong,
  type Intent,
} from './host'
import { RoomPlayer } from './player'
import { loadQueue, loadChat } from './room-data'

import { t } from './i18n'

// src/client/controller.ts
export interface PartyState {
  ready: boolean
  account: { uid: string; nickname: string } | null
  availableRoom: RoomSnapshot | null
  checkingRoom: boolean
  matching: boolean
  matchPhase: string
  matchSong: HostSong | null
  room: RoomSnapshot | null
  auditioning: boolean
  busy: boolean
  error: string
  notice: string
  health: string
  queue: RoomQueueEntry[]
  queueLoading: boolean
  messages: ChatMessage[]
  chatCursor: string | null
  chatMore: boolean
}
export class PartyController {
  state: PartyState
  readonly connection: AccountConnection
  private player: RoomPlayer | null
  private listeners = new Set<() => void>()
  private epoch = 0
  private disposed = false
  private matcher: RoomMatch
  private matchPreparing = false
  private timers: ReturnType<typeof setTimeout>[] = []
  private chatTask: Promise<void> | null = null
  private lastToast = new Map<string, number>()
  private polling: Promise<void> | null = null
  private queueTask: Promise<void> | null = null
  private queueAgain = false
  private transition: RoomTransition | null = null
  private interval = 5000
  private likeTail: Promise<void> = Promise.resolve()
  constructor(
    readonly folium: Folium,
    connection?: AccountConnection,
    private now = () => performance.now(),
  ) {
    const bridge = getPlaybackBridge(folium)
    this.state = {
      ready: !!bridge,
      account: null,
      availableRoom: null,
      checkingRoom: false,
      matching: false,
      matchPhase: '',
      matchSong: null,
      room: null,
      auditioning: false,
      busy: false,
      error: '',
      notice: '',
      health: '',
      queue: [],
      queueLoading: false,
      messages: [],
      chatCursor: null,
      chatMore: false,
    }
    this.connection = connection || new AccountConnection(folium)
    this.matcher = new RoomMatch(
      this.connection,
      (matching, matchPhase) => this.patch({ matching, matchPhase }),
      (raw) => {
        if (this.disposed) return
        try {
          this.begin()
          this.activateRoom(parseSnapshot(raw, this.now()), ++this.epoch)
        } catch (error: any) {
          this.patch({ error: error.message })
        }
      },
      (error) => {
        this.handleAccountError(error as Error & { code?: number })
        this.patch({ error: error.message })
      },
    )
    this.player = bridge
      ? new RoomPlayer(
          folium,
          bridge,
          now,
          (message) => this.patch({ error: message }),
          () => this.publishQueue(),
          (auditioning) => this.patch({ auditioning }),
        )
      : null
  }
  private publishQueue() {
    if (this.state.room) this.player?.setQueue(nativeQueue(this.state, this.player.metadata))
  }
  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  notify(message: string, type: 'info' | 'success' | 'error' = 'info') {
    if (!message || this.disposed) return
    const key = `${type}:${message}`,
      now = Date.now()
    if (now - (this.lastToast.get(key) ?? -Infinity) < (type === 'error' ? 10000 : 800)) return
    this.lastToast.set(key, now)
    if (this.lastToast.size > 80) this.lastToast.delete(this.lastToast.keys().next().value!)
    this.folium.ui.toast(t(message), { type, durationMs: type === 'error' ? 5000 : 2500 })
  }
  patch(value: Partial<PartyState>) {
    if (this.disposed) return
    if (value.account !== undefined && value.account?.uid !== this.state.account?.uid)
      value = { ...value, matchSong: null }
    if (value.notice) this.notify(value.notice, 'success')
    if (value.error) this.notify(value.error, 'error')
    this.state = { ...this.state, ...value, notice: '' }
    if (
      value.room !== undefined ||
      value.queue !== undefined ||
      value.busy !== undefined ||
      value.queueLoading !== undefined ||
      value.account !== undefined ||
      value.auditioning !== undefined
    )
      this.publishQueue()
    this.listeners.forEach((fn) => fn())
  }
  async run(action: () => Promise<unknown>) {
    if (this.state.busy || this.disposed) return
    this.patch({ busy: true, error: '' })
    try {
      await action()
    } catch (error: any) {
      this.handleAccountError(error)
      this.patch({
        error: error.deliveryUnknown
          ? t('发送结果未确认，请刷新消息后再决定是否重试。')
          : error.message || t('操作失败，请重试'),
      })
    } finally {
      this.patch({ busy: false })
    }
  }
  handleAccountError(error: { code?: number }) {
    if (error.code === 302 || error.code === 301) {
      this.detach()
      this.patch({ account: null })
    }
  }
  async connect() {
    if (this.state.room) throw new Error(t('请先退出当前房间'))
    const epoch = this.epoch
    const account = await this.connection.connect()
    if (this.disposed || epoch !== this.epoch) return
    this.patch({ account })
    await this.checkAvailableRoom()
  }
  async checkAvailableRoom() {
    const epoch = this.epoch
    if (!this.state.account || this.state.room || this.state.matching) return
    this.patch({ checkingRoom: true })
    try {
      const body = await this.connection.call('multiStatus')
      if (epoch !== this.epoch || this.disposed) return
      const raw = body.data?.multiLtRoomSnapshot
      this.patch({ availableRoom: raw?.roomId ? parseSnapshot(raw, this.now()) : null })
    } catch (error: any) {
      if (epoch === this.epoch) {
        this.handleAccountError(error)
        this.patch({ error: t('检查当前房间失败：{error}', { error: t(error.message) }) })
      }
    } finally {
      if (epoch === this.epoch) this.patch({ checkingRoom: false })
    }
  }
  async leaveAvailableRoom() {
    const { account, availableRoom, room, matching } = this.state
    if (!account || !availableRoom || room || matching || this.disposed) return
    const epoch = this.epoch
    await this.connection.call('multiLeave', { roomId: availableRoom.roomId })
    if (
      this.disposed ||
      epoch !== this.epoch ||
      this.state.account?.uid !== account.uid ||
      this.state.availableRoom?.roomId !== availableRoom.roomId ||
      this.state.room ||
      this.state.matching
    )
      return
    this.patch({ availableRoom: null, notice: t('已退出房间，当前音乐继续播放。') })
  }
  async match() {
    if (this.state.matching || this.matchPreparing || this.disposed) return
    const generation = this.epoch
    if (!this.state.account) throw new Error(t('请先登录网易云账号'))
    // Capture the chosen ID before any async leave/status request. Changing room playback
    // during those requests must not silently change the song used for this match attempt.
    const song = this.getMatchSong()
    if (song?.source !== 'netease' || !/^[1-9]\d*$/.test(song.id || ''))
      throw new Error(t('请选择一首网易云歌曲，再匹配房间'))
    const songId = song.id!
    this.matchPreparing = true
    this.patch({ matchSong: { ...song } })
    try {
      if (this.state.room) {
        await this.connection.call('multiRematchLeave', { roomId: this.state.room.roomId })
        if (generation !== this.epoch || this.disposed) return
        this.detach(true)
      } else {
        await this.checkAvailableRoom()
        if (generation !== this.epoch || this.disposed) return
        if (this.state.availableRoom) throw new Error(t('账号已有房间，请先恢复后重新匹配'))
      }
      await this.matcher.start(songId)
    } finally {
      this.matchPreparing = false
    }
  }
  getMatchSong(): HostSong | null {
    return this.state.matchSong || this.currentMatchSong()
  }
  currentMatchSong(): HostSong | null {
    const playback = this.folium.playback.getState().song
    const roomId = this.state.room?.playback?.song?.songId
    if (roomId && (playback?.source !== 'netease' || playback.id !== roomId)) {
      const track = this.state.queue.find((entry) => entry.songId === roomId)?.track
      return {
        id: roomId,
        source: 'netease',
        ref: null,
        title: track?.name || t('歌曲 {id}', { id: roomId }),
        artist: track?.artist || '',
        album: track?.album || null,
      }
    }
    return playback?.source === 'netease' && /^[1-9]\d*$/.test(playback.id || '') ? playback : null
  }
  selectMatchSong(song: HostSong | null) {
    if (this.disposed || !this.state.account) throw new Error(t('请先登录网易云账号'))
    if (this.state.busy || this.state.matching || this.matchPreparing)
      throw new Error(t('请等待当前操作完成后再切换歌曲'))
    if (song && (song.source !== 'netease' || !/^[1-9]\d*$/.test(song.id || '')))
      throw new Error(t('请选择有效的网易云歌曲'))
    this.patch({ matchSong: song ? { ...song } : null })
  }
  async cancelMatch() {
    try {
      await this.matcher.cancel()
    } catch (error: any) {
      this.patch({ error: error.message })
    }
    await this.checkAvailableRoom()
  }
  private begin() {
    if (this.disposed) throw new Error(t('账号连接已关闭'))
    if (!this.player)
      throw new Error(
        t('此 Folia 尚未提供 Music Party 播放适配接口 v2，请按插件说明安装适配版 Folia'),
      )
    if (!this.state.account) throw new Error(t('请先连接网易云账号'))
    if (this.state.room) throw new Error(t('请先退出当前房间'))
    this.player.start((intent) => this.intent(intent))
  }
  async enter(kind: 'restore' | 'join' | 'create', input = '', allowStrangerMatch = false) {
    if (this.state.matching) throw new Error(t('请先取消匹配'))
    const invite = kind === 'join' ? parseInvitation(input) : null
    const song = this.folium.playback.getState().song
    if (kind === 'create' && (song?.source !== 'netease' || !/^[1-9]\d*$/.test(song.id || ''))) {
      throw new Error(t('请先在 Folia 播放一首网易云歌曲，再创建多人房间'))
    }
    const epoch = ++this.epoch
    try {
      const started = this.now()
      const status = await this.connection.call('multiStatus')
      let raw = status.data?.multiLtRoomSnapshot
      if (kind !== 'restore') {
        if (raw?.roomId) throw new Error(t('账号已经在多人房间中，请使用“恢复当前房间”'))
        const result = await this.connection.call(
          kind === 'join' ? 'multiJoin' : 'multiCreate',
          invite
            ? { roomId: invite.roomId, inviterUid: invite.inviterUid }
            : { songId: song!.id, allowStrangerMatch },
        )
        raw = result.data?.multiLtRoomSnapshot
      }
      if (epoch !== this.epoch || this.disposed) return
      if (!raw) throw new Error(t('账号当前没有官方多人房间'))
      const snapshot = parseSnapshot(raw, (started + this.now()) / 2)
      this.begin()
      this.activateRoom(snapshot, epoch)
    } catch (error) {
      if (epoch === this.epoch) this.detach()
      throw error
    }
  }
  private activateRoom(snapshot: RoomSnapshot, epoch: number) {
    this.patch({
      room: snapshot,
      availableRoom: null,
      matching: false,
      notice: '',
      health: t('正在同步…'),
    })
    this.transition = new RoomTransition(
      () => this.state.room?.playback || null,
      () => this.refresh(),
      this.now,
    )
    this.apply(snapshot)
    this.repeat(
      () => this.observe(),
      () => this.interval,
      epoch,
    )
    this.repeat(
      () => this.refresh(),
      () => 10000,
      epoch,
    )
    this.repeat(
      () => this.refreshChat(),
      () => 6000,
      epoch,
    )
    this.repeat(
      () => this.refreshQueue(),
      () => 20000,
      epoch,
    )
    void this.refreshQueue()
    void this.refreshChat()
  }
  private repeat(task: () => Promise<void>, delay: () => number, epoch: number) {
    const next = () => {
      if (epoch !== this.epoch || this.disposed) return
      const timer = setTimeout(async () => {
        this.timers = this.timers.filter((item) => item !== timer)
        try {
          await task()
        } catch {
          /* Each refresh keeps its own visible error. */
        }
        next()
      }, delay())
      this.timers.push(timer)
    }
    next()
  }
  private apply(snapshot: RoomSnapshot) {
    const previous = this.state.room?.playback || null
    if (snapshot.playback && !shouldAccept(previous, snapshot.playback))
      snapshot = { ...snapshot, playback: previous }
    const changed =
      snapshot.playback?.song?.songBizId !== previous?.song?.songBizId ||
      snapshot.playback?.waitSongCount !== previous?.waitSongCount
    this.patch({
      room: snapshot,
      health: t('已同步 · {time}', { time: new Date().toLocaleTimeString() }),
    })
    if (snapshot.playback) void this.player?.apply(snapshot.playback)
    this.transition?.changed()
    if (changed) void this.refreshQueue()
  }
  async refresh() {
    const room = this.state.room,
      epoch = this.epoch
    if (!room) return
    const started = this.now()
    try {
      const body = await this.connection.call('multiStatus')
      if (epoch !== this.epoch) return
      const raw = body.data?.multiLtRoomSnapshot
      if (raw?.roomId !== room.roomId) {
        this.detach()
        this.patch({ notice: t('账号已离开或切换房间，请重新恢复。') })
        return
      }
      this.apply(parseSnapshot(raw, (started + this.now()) / 2))
    } catch (error: any) {
      if (epoch === this.epoch) this.connectionError(error)
    }
  }
  async observe() {
    if (this.polling) return this.polling
    const room = this.state.room,
      epoch = this.epoch
    if (!room) return
    const task = (async () => {
      const started = this.now()
      try {
        const body = await this.connection.call('multiHeartbeat', { roomId: room.roomId })
        if (epoch !== this.epoch || !this.state.room) return
        this.interval = heartbeatInterval(body.data?.heartBeatDuration)
        const playback = parseRoomPlayback(body.data?.roomPlaySongInfo, (started + this.now()) / 2)
        this.apply({ ...this.state.room, playback: playback || this.state.room.playback })
      } catch (error: any) {
        if (epoch === this.epoch) {
          this.interval = Math.min(this.interval * 2, 60000)
          this.connectionError(error)
        }
      }
    })()
    this.polling = task
    try {
      await task
    } finally {
      if (this.polling === task) this.polling = null
    }
  }
  private connectionError(error: any) {
    if ([301, 302, 488].includes(error.code)) {
      this.detach()
      if (error.code !== 488) this.patch({ account: null })
    } else this.player?.suspend()
    this.patch({
      health: t('同步暂不可用：{error}', { error: t(error.message) }),
      error: error.message,
    })
  }
  async refreshQueue() {
    if (this.queueTask) {
      this.queueAgain = true
      return this.queueTask
    }
    const room = this.state.room,
      epoch = this.epoch
    if (!room) return
    this.patch({ queueLoading: true })
    const task = (async () => {
      try {
        const queue = await loadQueue(
          this.connection.call.bind(this.connection),
          room.roomId,
          () => epoch === this.epoch,
        )
        if (epoch === this.epoch) this.patch({ queue })
      } catch (error: any) {
        if (epoch === this.epoch) this.patch({ error: error.message })
      } finally {
        if (epoch === this.epoch) this.patch({ queueLoading: false })
      }
    })()
    this.queueTask = task
    try {
      await task
    } finally {
      if (this.queueTask === task) {
        this.queueTask = null
        if (this.queueAgain && epoch === this.epoch) {
          this.queueAgain = false
          void this.refreshQueue()
        }
      }
    }
  }
  async refreshChat(older = false) {
    if (this.chatTask) {
      await this.chatTask
      if (!older) return
    }
    const room = this.state.room,
      account = this.state.account,
      epoch = this.epoch
    const cursor = older ? this.state.chatCursor : null
    if (!room || !account || (older && (!this.state.chatMore || !cursor))) return
    const task = (async () => {
      try {
        const page = await loadChat(
          this.connection.call.bind(this.connection),
          room.roomId,
          account.uid,
          [],
          cursor || undefined,
        )
        if (epoch !== this.epoch) return
        this.patch({
          messages: mergeChat(this.state.messages, page.messages),
          ...(!this.state.messages.length || older
            ? {
                chatCursor: page.cursor,
                chatMore: page.more && !!page.cursor && page.cursor !== cursor,
              }
            : {}),
        })
      } catch (error: any) {
        if (epoch === this.epoch) {
          this.handleAccountError(error)
          this.patch({ error: t('聊天刷新失败：{error}', { error: t(error.message) }) })
        }
      }
    })()
    this.chatTask = task
    try {
      await task
    } finally {
      if (this.chatTask === task) this.chatTask = null
    }
  }
  async send(text: string, emoji?: any) {
    const roomId = this.requireRoom().roomId
    await this.connection.call('multiChatSend', {
      roomId,
      text: text.trim(),
      ...(emoji ? { emoji } : {}),
      requestId: crypto.randomUUID(),
    })
    await this.refreshChat()
  }
  requireRoom() {
    if (!this.state.room) throw new Error(t('请先加入多人房间'))
    return this.state.room
  }
  async recommend(id: string) {
    await this.connection.call('multiAdd', { roomId: this.requireRoom().roomId, songId: id })
    this.patch({ notice: t('已推荐到房间待播列表') })
    await this.refreshQueue()
  }
  async operate(
    action: 'multiNext' | 'multiLike' | 'multiUp' | 'multiRemove',
    entry = this.requireRoom().playback?.song,
  ) {
    if (!entry) throw new Error(t('房间当前没有歌曲'))
    await this.connection.call(action, {
      roomId: this.requireRoom().roomId,
      songId: entry.songId,
      bizId: entry.songBizId,
    })
    this.patch({
      notice: {
        multiNext: t('已请求下一首'),
        multiLike: t('已为房间歌曲点赞'),
        multiUp: t('已提交置顶'),
        multiRemove: t('已删除自己的推荐'),
      }[action],
    })
    await this.refresh()
    await this.refreshQueue()
  }
  async syncQueue() {
    await this.refresh()
    await this.refreshQueue()
  }
  // Each click captures the occurrence; a pending vote can never migrate to another song/room.
  likeCurrent() {
    const epoch = this.epoch,
      roomId = this.state.room?.roomId,
      song = this.state.room?.playback?.song
    if (!roomId || !song || this.disposed) return Promise.resolve()
    this.likeTail = this.likeTail.then(async () => {
      if (
        this.disposed ||
        epoch !== this.epoch ||
        this.state.room?.roomId !== roomId ||
        this.state.room.playback?.song?.songBizId !== song.songBizId
      )
        return
      try {
        await this.connection.call('multiLike', {
          roomId,
          songId: song.songId,
          bizId: song.songBizId,
        })
        if (epoch !== this.epoch) return
        this.patch({ notice: t('已为房间歌曲点赞'), error: '' })
        await this.refresh()
      } catch (error: any) {
        if (epoch !== this.epoch) return
        if ([301, 302, 488].includes(error.code)) this.connectionError(error)
        else this.patch({ error: error.message || t('点赞失败，请重试') })
      }
    })
    return this.likeTail
  }
  private queueAction(entryId: string | null, actionId: string) {
    if (!entryId && actionId === 'return-room') {
      void this.returnToRoom()
      return
    }
    if (!entryId && actionId === 'sync') {
      void this.run(() => this.syncQueue())
      return
    }
    const current = this.state.room?.playback?.song
    if (entryId === current?.songBizId) {
      if (actionId === 'like') void this.likeCurrent()
      return
    }
    const entry = this.state.queue.find((entry) => entry.songBizId === entryId)
    if (!entry) return
    if (actionId === 'promote') void this.run(() => this.operate('multiUp', entry))
    if (actionId === 'remove' && entry.songRcmdUid === this.state.account?.uid)
      void this.run(() => this.operate('multiRemove', entry))
  }
  shareLink() {
    return invitation({
      roomId: this.requireRoom().roomId,
      inviterUid: this.state.account!.uid,
      role: 'unknown',
    })
  }
  async leave() {
    await this.connection.call('multiLeave', { roomId: this.requireRoom().roomId })
    this.detach(true)
    this.patch({ notice: t('已退出房间，当前音乐继续播放。') })
  }
  private intent(event: Intent) {
    if (!this.state.room) return
    if (event.type === 'queue-action') {
      this.queueAction(event.entryId, event.actionId)
      return
    }
    if (event.type === 'audition' || event.type === 'play') {
      // Older hosts send play; only enqueue is a recommendation, on every supported host.
      void this.player?.audition(event.song)
      return
    }
    if (this.player?.auditioning) {
      if (event.type === 'seek') {
        this.player.seekAudition(event.seconds, event.resume)
        return
      }
      if (['ended', 'next', 'previous', 'playback-error'].includes(event.type)) {
        if (event.type === 'playback-error') this.patch({ error: t('试听播放失败，已返回房间。') })
        void this.returnToRoom()
        return
      }
    }
    if (event.type === 'ended') {
      this.player?.ended()
      this.transition?.ended()
      return
    }
    if (event.type === 'seek' || event.type === 'previous') {
      this.player?.align(true)
      this.patch({ notice: t('多人房间跟随服务端进度，暂不支持回到上一首或修改房间进度。') })
      return
    }
    if (event.type === 'next') {
      void this.run(() => this.operate('multiNext'))
      return
    }
    if (event.type === 'playback-error') {
      this.folium.playback.pause()
      this.patch({ error: t('当前房间歌曲播放失败，请重新同步或请求下一首。') })
      return
    }
    const songs = event.type === 'enqueue' ? event.songs : []
    if (!songs.length) return
    if (songs.some((song) => song.source !== 'netease' || !song.id)) {
      this.patch({ error: t('多人房间只能推荐网易云歌曲，请先退出房间再播放其他来源。') })
      return
    }
    void this.run(async () => {
      const roomId = this.requireRoom().roomId
      for (const song of songs) await this.connection.call('multiAdd', { roomId, songId: song.id })
      this.patch({ notice: t('已推荐 {count} 首歌曲到房间', { count: songs.length }) })
      await this.refreshQueue()
    })
  }

  async returnToRoom() {
    if (!this.state.room || !this.player?.auditioning) return
    const returned = this.player.returnToRoom()
    // Apply the latest server position as soon as available, without room mutations.
    void this.refresh()
    await returned
  }

  detach(continuePlayback = false) {
    this.matcher.close()
    this.epoch++
    this.timers.forEach(clearTimeout)
    this.timers = []
    this.transition?.pause()
    this.transition = null
    this.polling = this.queueTask = null
    this.queueAgain = false
    this.player?.stop(continuePlayback)
    this.interval = 5000
    this.patch({
      room: null,
      matching: false,
      availableRoom: null,
      checkingRoom: false,
      queue: [],
      messages: [],
      health: '',
      chatCursor: null,
      chatMore: false,
      queueLoading: false,
    })
  }
  dispose() {
    this.detach()
    this.disposed = true
    this.player?.dispose()
    this.connection.close()
    this.listeners.clear()
  }
}
