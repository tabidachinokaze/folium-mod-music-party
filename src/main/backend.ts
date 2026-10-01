import { MediaSender } from '@party/main/media-send'
import { ApiService } from '@party/main/service'
import { createHttpInvoker } from '@party/main/transport'
import { multiEndpoints, multiPayload, type MultiMethod } from '@party/main/multi-api'
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
])
export function createBackend(fetcher: typeof fetch = fetch) {
  let current: {
    key: string
    service: ApiService
    media: MediaSender
    invoke: (endpoint: string, args: Record<string, unknown>) => Promise<{ body: any }>
  } | null = null
  let epoch = 0
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
    async matchCredentials() {
      const session = current
      if (!session) throw new Error('请先登录网易云')
      // Dedicated RPC: credentials never enter ApiService traces or view state.
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
      return { accId: data.accId, token: data.token }
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
      if (value?.file?.kind !== 'image' || !['private', 'sticker'].includes(value?.target?.kind))
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
    close() {
      epoch++
      current = null
    },
  }
}
