import { createMatchChannel, type MatchChannel, type MatchNotice } from './match-channel'
import type { AccountConnection } from './host'

// src/client/room-match.ts
function cancellable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error('匹配已取消'))
    if (signal.aborted) {
      void task.catch(() => {})
      cancel()
      return
    }
    signal.addEventListener('abort', cancel, { once: true })
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel))
  })
}
export class RoomMatch {
  private generation = 0
  private abort: AbortController | null = null
  private channel: MatchChannel | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private poll: ReturnType<typeof setTimeout> | null = null
  private acknowledging = false
  private started = false
  constructor(
    private connection: AccountConnection,
    private update: (matching: boolean, phase: string) => void,
    private accept: (raw: any) => void,
    private fail: (error: Error) => void,
    private channelFactory = createMatchChannel,
  ) {}
  private live(generation: number) {
    return generation === this.generation && !!this.channel
  }
  private timeout(ms: number, generation: number) {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (!this.live(generation)) return
      const started = this.started
      this.close()
      this.fail(new Error('匹配超时，请重试；当前音乐会继续播放。'))
      if (started) void this.connection.call('multiMatchCancel').catch(() => {})
    }, ms)
  }
  async start(songId: string) {
    this.close()
    const generation = this.generation
    const abort = (this.abort = new AbortController())
    const channel = (this.channel = this.channelFactory())
    this.update(true, '正在连接匹配服务…')
    this.timeout(20000, generation)
    try {
      const credentials = await cancellable(
        this.connection.attachment('matchCredentials', undefined),
        abort.signal,
      )
      if (!this.live(generation)) return
      await cancellable(
        channel.connect(
          credentials,
          (event) => void this.notice(event, generation),
          () => {
            if (!this.live(generation)) return
            void this.cancel().catch(() => {})
            this.fail(new Error('匹配通知连接已断开，请重试'))
          },
        ),
        abort.signal,
      )
      if (!this.live(generation)) return
      this.update(true, '正在寻找房间…')
      channel.arm()
      this.started = true
      const result = await cancellable(this.connection.call('multiMatch', { songId }), abort.signal)
      if (!this.live(generation)) return
      channel.confirmStart(Number(result.data?.startMatchTimeMills))
      if (!this.live(generation)) return
      const wait = Number(result.data?.maxWaitTimeMills)
      this.timeout(Number.isFinite(wait) && wait > 0 ? Math.min(wait, 120000) : 60000, generation)
      this.pollStatus(generation)
    } catch (error) {
      if (!this.live(generation)) return
      const started = this.started
      this.close()
      if (started) void this.connection.call('multiMatchCancel').catch(() => {})
      this.fail(
        new Error(`匹配失败：${error instanceof Error ? error.message : '无法连接官方匹配服务'}`),
      )
    }
  }
  private async notice(event: MatchNotice, generation: number) {
    if (!this.live(generation) || !this.started) return
    if (event.kind === 'failed') {
      this.close()
      this.fail(new Error(`官方匹配未成功（${event.reason}），请重试或换一首歌`))
      return
    }
    if (this.acknowledging) return
    this.acknowledging = true
    this.update(true, '已找到房间，正在加入…')
    try {
      const result = await this.connection.call('multiJoin', {
        roomId: event.roomId,
        inviterUid: '0',
      })
      if (!this.live(generation)) return
      const raw = result.data?.multiLtRoomSnapshot
      if (raw?.roomId !== event.roomId) throw new Error('匹配确认未返回对应房间')
      this.close()
      this.accept(raw)
    } catch (error) {
      if (this.live(generation)) {
        this.close()
        this.fail(error instanceof Error ? error : new Error('匹配确认失败'))
      }
    }
  }
  private pollStatus(generation: number) {
    this.poll = setTimeout(async () => {
      if (!this.live(generation)) return
      try {
        const body = await this.connection.call('multiStatus')
        if (!this.live(generation)) return
        // Polling only recovers an already confirmed room. Pending matches require official notification ACKs.
        const raw = body.data?.multiLtRoomSnapshot
        if (!this.acknowledging && body.data?.status === 'RECONNECT_SUCCESS' && raw?.roomId) {
          this.close()
          this.accept(raw)
          return
        }
      } catch {
        /* A separate deadline ends matching even if a status request hangs. */
      }
      if (this.live(generation)) this.pollStatus(generation)
    }, 2500)
  }
  async cancel() {
    const started = this.started
    this.close()
    if (started) await this.connection.call('multiMatchCancel')
  }
  close() {
    this.generation++
    this.abort?.abort()
    this.abort = null
    if (this.timer) clearTimeout(this.timer)
    if (this.poll) clearTimeout(this.poll)
    this.timer = this.poll = null
    this.channel?.close()
    this.channel = null
    this.started = this.acknowledging = false
    this.update(false, '')
  }
}
