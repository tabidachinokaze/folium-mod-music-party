import { randomUUID } from 'node:crypto'
import { parsePreciseJson, preciseMediaEndpoint } from './precise-json'
export function createHttpInvoker(base: string, fetcher: typeof fetch = fetch) {
  const url = new URL(base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('API 地址格式不正确')
  if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('远程 API 地址必须使用 HTTPS')
  return async (endpoint: string, args: Record<string, unknown>) => {
    const path = endpoint.replaceAll('_', '/')
    const target = new URL(`${url.pathname.replace(/\/$/, '')}/${path}`, url.origin)
    // Upstream cache keys ignore the POST body, even for /api. Never reuse state/auth/mutation replies.
    target.searchParams.set('timestamp', randomUUID())
    let response: Response
    try {
      response = await fetcher(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-apicache-bypass': 'true' },
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          ...args,
          cookie: args.cookie || 'MUSIC_U=; MUSIC_A=',
          noCookie: true,
          timestamp: Date.now(),
        }),
      })
    } catch {
      throw new Error('无法连接 ncm-api 或请求超时，请检查 Docker 服务和 API 地址')
    }
    let body: any
    try {
      body = preciseMediaEndpoint(args.uri)
        ? parsePreciseJson(await response.text())
        : await response.json()
    } catch {
      throw new Error(`ncm-api 返回非 JSON 内容（HTTP ${response.status}）`)
    }
    if (!response.ok)
      throw Object.assign(
        new Error(body.message || body.msg || `ncm-api 请求失败（HTTP ${response.status}）`),
        { body },
      )
    const cookies = response.headers.getSetCookie?.() || []
    if (!cookies.length && typeof body.cookie === 'string')
      cookies.push(
        ...body.cookie
          .split(';')
          .map((part: string) => part.trim())
          .filter((part: string) => /^(MUSIC_U|MUSIC_A|__csrf|NMTID|__remember_me)=/.test(part)),
      )
    return { body, cookie: cookies }
  }
}
