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
import { AccountConnection, getPlaybackBridge, type Folium, type Intent } from './host'
import { RoomPlayer } from './player'
import { loadQueue, loadChat } from './room-data'

// src/client/controller.ts
export interface PartyState {
  ready: boolean
  account: { uid: string; nickname: string } | null
  room: RoomSnapshot | null
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
  private timers: ReturnType<typeof setTimeout>[] = []
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
      room: null,
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
    this.player = bridge
      ? new RoomPlayer(
          folium,
          bridge,
          now,
          (message) => this.patch({ error: message }),
          () => this.publishQueue(),
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
  patch(value: Partial<PartyState>) {
    if (this.disposed) return
    this.state = { ...this.state, ...value }
    if (
      value.room !== undefined ||
      value.queue !== undefined ||
      value.busy !== undefined ||
      value.queueLoading !== undefined ||
      value.account !== undefined
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
          ? '发送结果未确认，请刷新消息后再决定是否重试。'
          : error.message || '操作失败，请重试',
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
    if (this.state.room) throw new Error('请先退出当前房间')
    const account = await this.connection.connect()
    this.patch({ account, notice: '已连接网易云账号，可以创建、加入或恢复多人房间。' })
  }
  private begin() {
    if (!this.player)
      throw new Error('此 Folia 尚未提供 Music Party 播放适配接口 v2，请按插件说明安装适配版 Folia')
    if (!this.state.account) throw new Error('请先连接网易云账号')
    if (this.state.room) throw new Error('请先退出当前房间')
    this.player.start((intent) => this.intent(intent))
  }
  async enter(kind: 'restore' | 'join' | 'create', input = '') {
    const invite = kind === 'join' ? parseInvitation(input) : null
    const song = this.folium.playback.getState().song
    if (kind === 'create' && (song?.source !== 'netease' || !/^[1-9]\d*$/.test(song.id || ''))) {
      throw new Error('请先在 Folia 播放一首网易云歌曲，再创建多人房间')
    }
    this.begin()
    const epoch = ++this.epoch
    try {
      const started = this.now()
      const status = await this.connection.call('multiStatus')
      let raw = status.data?.multiLtRoomSnapshot
      if (kind !== 'restore') {
        if (raw?.roomId) throw new Error('账号已经在多人房间中，请使用“恢复当前房间”')
        const result = await this.connection.call(
          kind === 'join' ? 'multiJoin' : 'multiCreate',
          invite ? { roomId: invite.roomId, inviterUid: invite.inviterUid } : { songId: song!.id },
        )
        raw = result.data?.multiLtRoomSnapshot
      }
      if (epoch !== this.epoch || this.disposed) return
      if (!raw) throw new Error('账号当前没有官方多人房间')
      const snapshot = parseSnapshot(raw, (started + this.now()) / 2)
      this.patch({
        room: snapshot,
        notice: '已进入官方多人一起听。点击网易云歌曲可推荐到房间。',
        health: '正在同步…',
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
    } catch (error) {
      if (epoch === this.epoch) this.detach()
      throw error
    }
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
    this.patch({ room: snapshot, health: `已同步 · ${new Date().toLocaleTimeString()}` })
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
        this.patch({ notice: '账号已离开或切换房间，请重新恢复。' })
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
    this.patch({ health: `同步暂不可用：${error.message}`, error: error.message })
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
    const room = this.state.room,
      account = this.state.account,
      epoch = this.epoch
    if (!room || !account) return
    try {
      const page = await loadChat(
        this.connection.call.bind(this.connection),
        room.roomId,
        account.uid,
        this.state.messages,
        older ? this.state.chatCursor || undefined : undefined,
      )
      if (epoch !== this.epoch) return
      this.patch({
        messages: mergeChat(this.state.messages, page.messages).slice(-1000),
        ...(!this.state.messages.length || older
          ? { chatCursor: page.cursor, chatMore: page.more }
          : {}),
      })
    } catch (error: any) {
      if (epoch === this.epoch) this.patch({ error: `聊天刷新失败：${error.message}` })
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
    if (!this.state.room) throw new Error('请先加入多人房间')
    return this.state.room
  }
  async recommend(id: string) {
    await this.connection.call('multiAdd', { roomId: this.requireRoom().roomId, songId: id })
    this.patch({ notice: '已推荐到房间待播列表' })
    await this.refreshQueue()
  }
  async operate(
    action: 'multiNext' | 'multiLike' | 'multiUp' | 'multiRemove',
    entry = this.requireRoom().playback?.song,
  ) {
    if (!entry) throw new Error('房间当前没有歌曲')
    await this.connection.call(action, {
      roomId: this.requireRoom().roomId,
      songId: entry.songId,
      bizId: entry.songBizId,
    })
    this.patch({
      notice: {
        multiNext: '已请求下一首',
        multiLike: '已为房间歌曲点赞',
        multiUp: '已提交置顶',
        multiRemove: '已删除自己的推荐',
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
        this.patch({ notice: '已为房间歌曲点赞', error: '' })
        await this.refresh()
      } catch (error: any) {
        if (epoch !== this.epoch) return
        if ([301, 302, 488].includes(error.code)) this.connectionError(error)
        else this.patch({ error: error.message || '点赞失败，请重试' })
      }
    })
    return this.likeTail
  }
  private queueAction(entryId: string | null, actionId: string) {
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
    this.detach()
    this.patch({ notice: '已退出房间，个人播放队列已恢复。' })
  }
  private intent(event: Intent) {
    if (!this.state.room) return
    if (event.type === 'queue-action') {
      this.queueAction(event.entryId, event.actionId)
      return
    }
    if (event.type === 'ended') {
      this.player?.ended()
      this.transition?.ended()
      return
    }
    if (event.type === 'seek' || event.type === 'previous') {
      this.player?.align(true)
      this.patch({ notice: '多人房间跟随服务端进度，暂不支持回到上一首或修改房间进度。' })
      return
    }
    if (event.type === 'next') {
      void this.run(() => this.operate('multiNext'))
      return
    }
    if (event.type === 'playback-error') {
      this.folium.playback.pause()
      this.patch({ error: '当前房间歌曲播放失败，请重新同步或请求下一首。' })
      return
    }
    const songs = event.type === 'enqueue' ? event.songs : event.type === 'play' ? [event.song] : []
    if (!songs.length) return
    if (songs.some((song) => song.source !== 'netease' || !song.id)) {
      this.patch({ error: '多人房间只能推荐网易云歌曲，请先退出房间再播放其他来源。' })
      return
    }
    void this.run(async () => {
      const roomId = this.requireRoom().roomId
      for (const song of songs) await this.connection.call('multiAdd', { roomId, songId: song.id })
      this.patch({ notice: `已推荐 ${songs.length} 首歌曲到房间` })
      await this.refreshQueue()
    })
  }

  detach() {
    this.epoch++
    this.timers.forEach(clearTimeout)
    this.timers = []
    this.transition?.pause()
    this.transition = null
    this.polling = this.queueTask = null
    this.queueAgain = false
    this.player?.stop()
    this.interval = 5000
    this.patch({
      room: null,
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
