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
  'multiCreate',
  'multiJoin',
  'multiAdd',
  'multiNext',
  'multiRemove',
  'multiUp',
  'multiLike',
])
export function createBackend(fetcher: typeof fetch = fetch) {
  let current: { key: string; service: ApiService } | null = null
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
      current = { key, service }
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
    close() {
      epoch++
      current = null
    },
  }
}
