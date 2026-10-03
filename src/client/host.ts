import type {
  FoliumSong,
  FoliumPlaybackSessionIntent,
  FoliumPlaybackStartResult,
  FoliumPlaybackSession,
  FoliumPlaybackSessions,
} from '../../vendor/folium/contract'
import type { Method, Reply } from '@party/shared/types'

import { t } from './i18n'

// src/client/host.ts
export type HostSong = FoliumSong
export interface PlaybackState {
  song: HostSong | null
  state: 'playing' | 'paused' | 'stopped'
  position: number
  duration: number
}
export type Intent = FoliumPlaybackSessionIntent
export type PlaybackResult = FoliumPlaybackStartResult
export type Lease = FoliumPlaybackSession
export type ExternalPlayback = FoliumPlaybackSessions
export interface Folium {
  env: { context: string }
  internals: { omni: any }
  experimental: { 'playback.sessions'?: ExternalPlayback }
  rpc: { call<T = any>(name: string, ...args: unknown[]): Promise<T> }
  events: { on(name: string, fn: (event: any) => void): () => void }
  playback: {
    getState(): PlaybackState
    play(): void
    pause(): void
    playSong(song: HostSong): Promise<boolean>
    auditionSong?(song: HostSong): Promise<boolean>
  }
  ui: {
    navigate(view: 'home' | 'player'): void
    openPlayerPanel(id?: string): void
    openHomeTab(id: string): void
    openQueue(): void
    openAlbum?(provider: string, albumId: string): Promise<boolean>
    toast(
      message: string,
      options?: { type: 'info' | 'success' | 'error'; durationMs?: number },
    ): void
    icon(name: string, options?: any): Promise<SVGSVGElement | null>
  }
  registries: Record<string, { register(def: any): { unregister(): void } }>
}
export function getPlaybackBridge(folium: Folium): ExternalPlayback | null {
  try {
    const bridge = folium.experimental['playback.sessions']
    return bridge?.version === 2 && bridge.supportsHandoff === true ? bridge : null
  } catch {
    return null
  }
}

/** Search only through the pinned host Omni adapter; these DTOs cannot start playback. */
export async function searchMatchSongs(folium: Folium, query: string): Promise<HostSong[]> {
  const text = query.trim()
  if (!text) return []
  const omni = folium.internals.omni
  if (typeof omni?.searchProviderSongs !== 'function')
    throw new Error(t('当前 Folia 暂不支持歌曲搜索，请升级宿主后重试'))
  const page = await omni.searchProviderSongs('netease', text, { limit: 30, offset: 0 })
  const result: HostSong[] = [],
    seen = new Set<string>()
  for (const item of Array.isArray(page?.items) ? page.items : []) {
    const source = item?.sourceRef
    const id = String(source?.mediaId ?? item?.id ?? '')
    if (
      source?.kind !== 'online' ||
      source.providerId !== 'netease' ||
      !/^[1-9]\d*$/.test(id) ||
      seen.has(id)
    )
      continue
    seen.add(id)
    result.push({
      id,
      source: 'netease',
      ref: null,
      title: typeof item.name === 'string' ? item.name : t('歌曲 {id}', { id }),
      artist: Array.isArray(item.artists)
        ? item.artists
            .map((artist: any) => (typeof artist?.name === 'string' ? artist.name : ''))
            .filter(Boolean)
            .join(' / ')
        : '',
      album: typeof item.album?.name === 'string' ? item.album.name : null,
    })
  }
  return result
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
    if (!cookie) throw new Error(t('请先在 Folia 设置中登录网易云账号，再连接一起听'))
    if (!port) throw new Error(t('Folia 内置网易云服务尚未启动，请稍后重试'))
    if (epoch !== this.epoch) throw new Error(t('连接已取消'))
    await this.folium.rpc.call('connect', cookie, port)
    if (epoch !== this.epoch) throw new Error(t('连接已取消'))
    this.cookie = cookie
    this.port = port
    const body = await this.call('account')
    const profile = body?.data?.profile
    if (!profile?.userId) throw new Error(t('网易云登录已失效，请在 Folia 重新登录'))
    return { uid: String(profile.userId), nickname: String(profile.nickname || t('网易云用户')) }
  }
  async call(method: Method, args: Record<string, unknown> = {}) {
    const epoch = this.epoch
    if (!this.cookie || this.readCookie() !== this.cookie)
      throw Object.assign(new Error(t('网易云账号已变化，请重新连接一起听')), { code: 302 })
    const port = await this.readPort()
    if (epoch !== this.epoch || this.readCookie() !== this.cookie)
      throw Object.assign(new Error(t('账号已变化')), { code: 302 })
    if (!port) throw new Error(t('Folia 网易云服务暂不可用'))
    if (port !== this.port) {
      await this.folium.rpc.call('connect', this.cookie, port)
      this.port = port
    }
    const reply = await this.folium.rpc.call<Reply>('call', { method, args })
    if (epoch !== this.epoch || this.readCookie() !== this.cookie)
      throw Object.assign(new Error(t('账号已变化')), { code: 302 })
    if (!reply.ok)
      throw Object.assign(new Error(reply.error || t('请求失败')), {
        code: reply.code,
        deliveryUnknown: reply.deliveryUnknown,
      })
    return reply.data
  }
  async matchTransport(name: 'matchOpen' | 'matchPoll' | 'matchClose', id: string) {
    if (name === 'matchClose') return this.folium.rpc.call(name, id)
    if (name === 'matchOpen') await this.call('account')
    const epoch = this.epoch
    if (!this.cookie || this.readCookie() !== this.cookie) throw new Error(t('账号已变化'))
    const result = await this.folium.rpc.call(name, id)
    if (epoch !== this.epoch || this.readCookie() !== this.cookie) {
      void this.folium.rpc.call('matchClose', id).catch(() => {})
      throw new Error(t('账号已变化'))
    }
    return result
  }
  async attachment(name: 'media' | 'removeStickers' | 'saveSticker', payload: unknown) {
    // Recheck the current Folia account and service port before every upload/mutation.
    await this.call('account')
    const epoch = this.epoch
    const reply = await this.folium.rpc.call(name, payload)
    if (epoch !== this.epoch || this.readCookie() !== this.cookie) throw new Error(t('账号已变化'))
    if (name === 'media' && !reply?.ok)
      throw Object.assign(new Error(reply?.error || t('图片发送失败')), {
        code: reply?.code,
        deliveryUnknown: reply?.deliveryUnknown === true,
      })
    return reply
  }
  close() {
    this.epoch++
    this.cookie = ''
    void this.folium.rpc.call('disconnect').catch(() => {})
  }
}

/** Read only session identity here; never pass credentials into view props or diagnostics. */
export function activeNeteaseSession(): string {
  if ((localStorage.getItem('active_online_provider_id') || 'netease') !== 'netease') return ''
  const cookie =
    localStorage.getItem('online_provider:netease:cookie') ||
    localStorage.getItem('netease_cookie') ||
    ''
  return /(?:^|;\s*)MUSIC_U=[^;\s]+/.test(cookie) ? cookie : ''
}
