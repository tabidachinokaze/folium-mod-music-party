import { expect, it, vi } from 'vitest'
import { downloadStickerImage } from '../src/main/sticker-image'
import { createBackend } from '../src/main/backend'
import { MEDIA_LIMITS } from '@party/shared/media'

// tests/sticker-image.test.ts
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
const source = { kind: 'image', url: 'https://p1.music.126.net/message.gif', width: 1, height: 1 }
const fileResponse = () => new Response(gif, { headers: { 'Content-Type': 'image/gif' } })
const json = (value: unknown) => new Response(JSON.stringify(value))

it('follows only validated public NetEase image redirects without sending credentials', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://p2.music.126.net/image.gif' },
      }),
    )
    .mockResolvedValueOnce(fileResponse())
  expect(await downloadStickerImage(source, fetcher, () => {})).toMatchObject({
    kind: 'image',
    mime: 'image/gif',
    width: 1,
    height: 1,
    data: new Uint8Array(gif),
  })
  expect(fetcher).toHaveBeenCalledTimes(2)
  for (const [_url, options] of fetcher.mock.calls) {
    expect(options).toMatchObject({
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    expect(options?.body).toBeUndefined()
    expect(new Headers(options?.headers).has('cookie')).toBe(false)
    expect(new Headers(options?.headers).has('authorization')).toBe(false)
    expect(new Headers(options?.headers).has('x-nos-token')).toBe(false)
  }
})

it.each([
  'https://127.0.0.1/private',
  'http://192.168.1.1/private',
  'https://music.126.net.evil.test/img',
  'https://user:password@p1.music.126.net/img',
  'https://p1.music.126.net:1234/img',
  'file:///etc/hosts',
])('rejects %s before download and if an allowed CDN redirects there', async (url) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 302, headers: { location: url } }))
  await expect(downloadStickerImage({ ...source, url }, fetcher, () => {})).rejects.toThrow(
    '图片地址',
  )
  expect(fetcher).not.toHaveBeenCalled()
  await expect(downloadStickerImage(source, fetcher, () => {})).rejects.toThrow('图片地址')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('limits redirects and rejects untrusted MIME or oversized responses', async () => {
  const redirects = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () => new Response(null, { status: 302, headers: { location: '/loop.gif' } }),
    )
  await expect(downloadStickerImage(source, redirects, () => {})).rejects.toThrow('图片地址')
  expect(redirects).toHaveBeenCalledTimes(4)
  const invalidHeaders: Record<string, string>[] = [
    { 'Content-Type': 'text/html' },
    { 'Content-Type': 'image/svg+xml' },
    { 'Content-Type': 'image/gif', 'Content-Length': String(MEDIA_LIMITS.image + 1) },
  ]
  for (const headers of invalidHeaders) {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('bad', { headers }))
    await expect(downloadStickerImage(source, fetcher, () => {})).rejects.toThrow()
  }
  const cancelled = vi.fn()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MEDIA_LIMITS.image + 1))
    },
    cancel: cancelled,
  })
  const oversized = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(stream, { headers: { 'Content-Type': 'image/gif' } }))
  await expect(downloadStickerImage(source, oversized, () => {})).rejects.toThrow('20 MB')
  expect(cancelled).toHaveBeenCalledOnce()
})

function environment() {
  const calls: { uri: string; data: any }[] = []
  const fetcher = vi.fn<typeof fetch>(async (url, options) => {
    if (String(url) === source.url) return fileResponse()
    if (String(url).startsWith('https://nosup-hz1.127.net/')) return json({})
    const payload = JSON.parse(String(options?.body))
    const uri = payload.uri || new URL(url as URL).pathname
    calls.push({ uri, data: payload.data })
    if (uri === '/login/status') return json({ code: 200, data: { profile: { userId: 9 } } })
    if (uri === '/api/nos/token/alloc')
      return json({
        code: 200,
        result: {
          bucket: 'yyimgs',
          docId: '12345678901234567890',
          objectKey: 'message.gif',
          token: 'mock-upload',
        },
      })
    if (uri === '/api/social/emoji/upload')
      return json({
        code: 200,
        data: {
          emojiMap: [
            {
              emojiId: '99',
              emojiGroupId: '-1',
              picId: '12345678901234567890',
              emojiImgUrl: source.url,
            },
          ],
        },
      })
    throw new Error(`Unexpected test endpoint: ${uri}`)
  })
  const backend = createBackend(fetcher)
  backend.connect('MUSIC_U=test-only', 4176)
  return { backend, fetcher, calls }
}

it('adds a plain chat image through NOS and sticker upload, never collect(0) or a chat send', async () => {
  const { backend, fetcher, calls } = environment()
  const result = await backend.saveSticker(source)
  expect(result).toMatchObject({ emojiId: '99' })
  expect(calls.some(({ uri }) => uri.endsWith('/emoji/upload'))).toBe(true)
  expect(calls.some(({ uri }) => uri.endsWith('/emoji/collect') || uri.includes('/send'))).toBe(
    false,
  )
  const upload = calls.find(({ uri }) => uri.endsWith('/emoji/upload'))!
  expect(JSON.parse(upload.data.imgs)).toEqual([
    { picId: '12345678901234567890', width: 1, height: 1, format: 'gif' },
  ])
  expect(fetcher.mock.calls.find(([url]) => String(url) === source.url)?.[1]?.headers).toEqual({
    Accept: 'image/png,image/jpeg,image/gif,image/webp',
  })
  backend.close()
})

it('checks image bytes against the MIME before any authenticated API/upload call', async () => {
  const { backend, fetcher, calls } = environment()
  fetcher.mockResolvedValueOnce(
    new Response('<html>not an image</html>', { headers: { 'Content-Type': 'image/gif' } }),
  )
  await expect(backend.saveSticker(source)).rejects.toThrow('PNG')
  expect(calls).toEqual([])
  expect(fetcher).toHaveBeenCalledTimes(1)
  backend.close()
})

it('cancels the received image body and never uploads after an account switch during download', async () => {
  const { backend, fetcher, calls } = environment()
  const cancelled = vi.fn()
  fetcher.mockImplementationOnce(async () => {
    backend.connect('MUSIC_U=other-test-account', 4176)
    return new Response(new ReadableStream({ cancel: cancelled }), {
      headers: { 'Content-Type': 'image/gif' },
    })
  })
  await expect(backend.saveSticker(source)).rejects.toThrow('账号已变化')
  expect(cancelled).toHaveBeenCalledOnce()
  expect(calls).toEqual([])
  backend.close()
})

it('requires a confirmed upload result rather than reporting an unconfirmed save as success', async () => {
  const { backend, fetcher } = environment()
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (url, options) => {
    if (String(options?.body).includes('/api/social/emoji/upload'))
      return json({ code: 200, data: { emojiMap: [], toast: 'not saved' } })
    return original(url, options)
  })
  await expect(backend.saveSticker(source)).rejects.toThrow('not saved')
  backend.close()
})
