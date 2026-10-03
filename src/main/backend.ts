import { MiniNotifications } from './mini-notifications'
import { MediaSender } from '@party/main/media-send'
import { ApiService } from '@party/main/service'
import { createHttpInvoker } from '@party/main/transport'
import { multiEndpoints, multiPayload, type MultiMethod } from '@party/main/multi-api'
import { receivedStickerIdentity } from '@party/shared/stickers'
import { randomUUID } from 'node:crypto'
import { downloadStickerImage } from './sticker-image'
import type { Request, Reply } from '@party/shared/types'

// src/main/backend.ts
const allowed = new Set([
  ...Object.keys(multiEndpoints),
  'account',
  'privateConversations',
  'privateHistory',
  'privateRead',
  'privateSend',
  'privateInvite',
  'privateSticker',
  'stickerGroups',
  'stickerPage',
])
const needsToken = new Set([
  'multiMatch',
  'multiCreate',
  'multiJoin',
  'multiAdd',
  'multiNext',
  'multiRemove',
  'multiUp',
  'multiLike',
  'multiRedHeart',
])
export function createBackend(
  fetcher: typeof fetch = fetch,
  makeNotifications: () => Pick<MiniNotifications, 'open' | 'poll' | 'close'> = () =>
    new MiniNotifications(),
) {
  let current: {
    key: string
    service: ApiService
    media: MediaSender
    invoke: (endpoint: string, args: Record<string, unknown>) => Promise<{ body: any }>
  } | null = null
  let epoch = 0
  let matching: {
    id: string
    notifications: Pick<MiniNotifications, 'open' | 'poll' | 'close'>
  } | null = null
  const closeMatch = (id?: string) => {
    if (matching && (!id || matching.id === id)) {
      matching.notifications.close()
      matching = null
    }
  }
  return {
    connect(cookie: string, port: number) {
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('Folia 网易云服务尚未就绪')
      if (
        typeof cookie !== 'string' ||
        cookie.length > 32768 ||
        !/(?:^|;\s*)MUSIC_U=[^;\s]+/.test(cookie)
      ) {
        throw new Error('请先在 Folia 登录网易云账号')
      }
      const key = `${port}:${cookie}`
      if (current?.key === key) return
      closeMatch()
      epoch++
      const mine = epoch
      const standard = createHttpInvoker(`http://127.0.0.1:${port}`, fetcher)
      const invoke = async (endpoint: string, args: Record<string, unknown>) => {
        if (mine !== epoch) throw new Error('账号已变化，请重新连接')
        let result
        if (Object.hasOwn(multiEndpoints, endpoint)) {
          let token = ''
          if (needsToken.has(endpoint)) {
            token = (await standard('register_checktoken_v3', { timeout: 12000 })).body?.token || ''
            if (!token) throw new Error('未取得网易云请求校验令牌，请稍后重试')
          }
          if (mine !== epoch) throw new Error('账号已变化，请重新连接')
          result = await standard('api', {
            uri: multiEndpoints[endpoint as MultiMethod],
            data: multiPayload(endpoint as MultiMethod, args, token),
            crypto: 'eapi',
            cookie: args.cookie,
          })
        } else result = await standard(endpoint, args)
        if (mine !== epoch) throw new Error('账号已变化，请重新连接')
        return result
      }
      const service = new ApiService(invoke)
      service.restore(cookie)
      const media = new MediaSender(
        invoke,
        () => ({ cookie: mine === epoch ? cookie : '', epoch }),
        fetcher,
      )
      current = {
        key,
        service,
        media,
        invoke: (endpoint, args) => invoke(endpoint, { ...args, cookie }),
      }
    },
    async call(request: Request): Promise<Reply> {
      if (!current) return { ok: false, error: '请先连接 Folia 的网易云账号' }
      if (!allowed.has(request?.method)) return { ok: false, error: '插件不支持此操作' }
      const { trace: _trace, ...reply } = await current.service.call(request)
      return {
        ...reply,
        ...(reply.error
          ? { error: reply.error.replace('Docker 服务和 API 地址', 'Folia 网易云服务') }
          : {}),
      }
    },
    async matchOpen(id: string) {
      if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,64}$/.test(id))
        throw new Error('匹配会话标识无效')
      closeMatch()
      const active = { id, notifications: makeNotifications() }
      matching = active
      try {
        const session = current
        if (!session) throw new Error('请先登录网易云')
        // Credentials stay in the main process and never enter RPC results or ApiService traces.
        const { body } = await session.invoke('api', {
          uri: '/api/middle/im/token/get',
          crypto: 'eapi',
          data: { bizTag: 'platform' },
        })
        if (session !== current) throw new Error('账号已变化')
        const data = body?.data
        if (
          body?.code !== 200 ||
          typeof data?.accId !== 'string' ||
          typeof data?.token !== 'string' ||
          !data.accId ||
          !data.token
        )
          throw new Error('未取得官方匹配通知凭据，请重新登录网易云后重试')
        if (matching !== active) throw new Error('匹配已取消')
        await active.notifications.open({ accId: data.accId, token: data.token })
        if (matching !== active || session !== current) throw new Error('匹配已取消')
      } catch (error) {
        if (matching === active) matching = null
        active.notifications.close()
        throw error
      }
    },
    matchPoll(id: string) {
      if (!matching || matching.id !== id) throw new Error('匹配通知连接已关闭')
      return matching.notifications.poll()
    },
    matchClose(id: string) {
      closeMatch(id)
    },
    async media(value: any) {
      if (!current) return { ok: false, error: '请先连接网易云账号' }
      const encoded = value?.file?.base64
      if (
        typeof encoded !== 'string' ||
        encoded.length > 28 * 1024 * 1024 ||
        encoded.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
      )
        return { ok: false, error: '图片数据无效或超过 20 MB' }
      if (
        value?.file?.kind !== 'image' ||
        !['private', 'sticker', 'room'].includes(value?.target?.kind)
      )
        return { ok: false, error: '不支持的图片用途' }
      return current.media.send(
        { ...value, file: { ...value.file, data: new Uint8Array(Buffer.from(encoded, 'base64')) } },
        () => {},
      )
    },
    async removeStickers(ids: unknown) {
      if (!current) throw new Error('请先连接网易云账号')
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 100 ||
        ids.some((id) => typeof id !== 'string' || !/^[1-9]\d{0,23}$/.test(id))
      )
        throw new Error('表情 ID 无效')
      const { body } = await current.invoke('api', {
        uri: '/api/social/emoji/cancel',
        crypto: 'eapi',
        // Numeric JSON tokens preserve the official long IDs without JS Number rounding.
        data: { emojiIds: `[${[...new Set(ids)].join(',')}]` },
      })
      if (body?.code !== 200 || body?.data?.result !== true)
        throw new Error(body?.data?.toast || body?.message || '表情删除未确认，请刷新后重试')
    },
    async saveSticker(value: unknown) {
      if (!current) throw new Error('请先连接网易云账号')
      const session = current
      if ((value as { kind?: unknown } | null)?.kind === 'image') {
        const check = () => {
          if (session !== current) throw new Error('账号已变化，请重新选择图片')
        }
        const file = await downloadStickerImage(value, fetcher, check)
        check()
        const reply = await session.media.send(
          { requestId: randomUUID(), target: { kind: 'sticker' }, file },
          () => {},
        )
        check()
        if (!reply.ok)
          throw Object.assign(new Error(reply.error || '表情保存失败，请重试'), {
            code: reply.code,
            deliveryUnknown: reply.deliveryUnknown,
          })
        return reply.receipt?.emoji || true
      }
      const identity = receivedStickerIdentity(value)
      const { body } = await session.invoke('api', {
        uri: '/api/social/emoji/collect',
        crypto: 'eapi',
        data: identity,
      })
      if (body?.code !== 200 || body?.data?.result !== true)
        throw new Error(
          body?.data?.toast || body?.message || '表情保存结果未确认，请刷新自定义表情',
        )
      return true
    },
    close() {
      closeMatch()
      epoch++
      current = null
    },
  }
}
