import type { Method, Reply } from '@party/shared/types'

// src/client/host.ts
export interface HostSong {
  id: string | null
  source: string | null
  ref: string | null
  title: string
  artist: string
}
export interface PlaybackState {
  song: HostSong | null
  state: 'playing' | 'paused' | 'stopped'
  position: number
  duration: number
}
export type Intent = {
  type: 'select' | 'next' | 'previous' | 'ended' | 'seek'
  song?: HostSong
  seconds?: number
}
export interface Lease {
  play(song: HostSong): Promise<boolean>
  seek(seconds: number): void
  release(): void
}
export interface ExternalPlayback {
  version: number
  resolveSong(provider: string, id: string): Promise<HostSong>
  acquire(fn: (event: Intent) => void): Lease
}
export interface Folium {
  env: { context: string }
  internals: { externalPlayback?: ExternalPlayback; omni: any }
  rpc: { call<T = any>(name: string, ...args: unknown[]): Promise<T> }
  events: { on(name: string, fn: (event: any) => void): () => void }
  playback: { getState(): PlaybackState; play(): void; pause(): void }
  ui: {
    navigate(view: 'home' | 'player'): void
    openPlayerPanel(id?: string): void
    toast(message: string, options?: { type: string }): void
    icon(name: string, options?: any): SVGElement
  }
  registries: Record<string, { register(def: any): { unregister(): void } }>
}
export function getPlaybackBridge(folium: Folium): ExternalPlayback | null {
  try {
    const bridge = folium.internals.externalPlayback
    return bridge?.version === 1 ? bridge : null
  } catch {
    return null
  }
}

/** The pinned adapter is the only client module that knows Folia's session storage. */
export class AccountConnection {
  private cookie = ''
  private port = 0
  private epoch = 0
  constructor(
    private folium: Folium,
    private readCookie = () =>
      localStorage.getItem('online_provider:netease:cookie') ||
      localStorage.getItem('netease_cookie') ||
      '',
    private readPort = async () =>
      (window as any).electron?.getNeteasePort?.() as Promise<number | null>,
  ) {}
  async connect() {
    const epoch = ++this.epoch
    const cookie = this.readCookie()
    const port = await this.readPort()
    if (!cookie) throw new Error('请先在 Folia 设置中登录网易云账号，再连接一起听')
    if (!port) throw new Error('Folia 内置网易云服务尚未启动，请稍后重试')
    if (epoch !== this.epoch) throw new Error('连接已取消')
    await this.folium.rpc.call('connect', cookie, port)
    if (epoch !== this.epoch) throw new Error('连接已取消')
    this.cookie = cookie
    this.port = port
    const body = await this.call('account')
    const profile = body?.data?.profile
    if (!profile?.userId) throw new Error('网易云登录已失效，请在 Folia 重新登录')
    return { uid: String(profile.userId), nickname: String(profile.nickname || '网易云用户') }
  }
  async call(method: Method, args: Record<string, unknown> = {}) {
    const epoch = this.epoch
    if (!this.cookie || this.readCookie() !== this.cookie)
      throw Object.assign(new Error('网易云账号已变化，请重新连接一起听'), { code: 302 })
    const port = await this.readPort()
    if (epoch !== this.epoch || this.readCookie() !== this.cookie)
      throw Object.assign(new Error('账号已变化'), { code: 302 })
    if (!port) throw new Error('Folia 网易云服务暂不可用')
    if (port !== this.port) {
      await this.folium.rpc.call('connect', this.cookie, port)
      this.port = port
    }
    const reply = await this.folium.rpc.call<Reply>('call', { method, args })
    if (epoch !== this.epoch || this.readCookie() !== this.cookie)
      throw Object.assign(new Error('账号已变化'), { code: 302 })
    if (!reply.ok)
      throw Object.assign(new Error(reply.error || '请求失败'), {
        code: reply.code,
        deliveryUnknown: reply.deliveryUnknown,
      })
    return reply.data
  }
  close() {
    this.epoch++
    this.cookie = ''
    void this.folium.rpc.call('disconnect').catch(() => {})
  }
}
