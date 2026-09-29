import { expect, it, vi } from 'vitest'
import { createBackend } from '../src/main/backend'

// tests/private-media.test.ts
const image = (target: unknown) => ({
  requestId: '12345678-1234-1234-1234-123456789012',
  target,
  file: {
    kind: 'image',
    name: 'custom.gif',
    mime: 'image/gif',
    width: 1,
    height: 1,
    base64: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  },
})
function environment() {
  const calls: { uri: string; data: any }[] = []
  const response = (body: unknown) => new Response(JSON.stringify(body))
  const fetcher = vi.fn(async (url: any, options: any) => {
    if (String(url).startsWith('https://nosup-hz1.127.net/')) return response({})
    const args = JSON.parse(options.body)
    const uri = args.uri || new URL(url).pathname
    calls.push({ uri, data: args.data })
    if (uri === '/login/status') return response({ code: 200, data: { profile: { userId: 9 } } })
    if (uri === '/register/checktoken/v3') return response({ code: 200, token: 'mock-token' })
    if (uri === '/api/nos/token/alloc')
      return response({
        code: 200,
        result: {
          bucket: 'yyimgs',
          docId: '12345678901234567890',
          objectKey: 'fixture.gif',
          token: 'mock-upload',
        },
      })
    if (uri === '/api/social/emoji/upload')
      return response({
        code: 200,
        data: {
          emojiMap: [
            {
              emojiId: '99',
              emojiGroupId: '1',
              emojiName: '自定义',
              picId: '12345678901234567890',
              emojiImgUrl: 'https://p1.music.126.net/fixture.gif',
            },
          ],
        },
      })
    if (uri === '/api/communication/send/msg')
      return response({ code: 200, data: { msgBody: { msgId: '99', status: 0 } } })
    if (uri === '/api/social/emoji/cancel') return response({ code: 200, data: { result: true } })
    throw new Error(`Unexpected test endpoint: ${uri}`)
  })
  const backend = createBackend(fetcher as typeof fetch)
  backend.connect('MUSIC_U=test', 4176)
  return { backend, fetcher, calls }
}
it('uploads a saved sticker once and never sends it to a conversation', async () => {
  const { backend, calls } = environment()
  const request = image({ kind: 'sticker' })
  const replies = await Promise.all([backend.media(request), backend.media(request)])
  expect(replies.every((reply) => reply.ok)).toBe(true)
  expect(calls.filter((call) => call.uri === '/api/social/emoji/upload')).toHaveLength(1)
  expect(calls.some((call) => call.uri.includes('communication'))).toBe(false)
  expect(
    JSON.parse(calls.find((call) => call.uri.endsWith('/emoji/upload'))!.data.imgs)[0].picId,
  ).toBe('12345678901234567890')
})
it('sends the image to the captured peer with a single image message body', async () => {
  const { backend, calls } = environment()
  expect((await backend.media(image({ kind: 'private', uid: '10' }))).ok).toBe(true)
  const body = JSON.parse(
    calls.find((call) => call.uri.endsWith('/communication/send/msg'))!.data.sendMsgBody,
  )
  expect(body.receiverUserIds).toBe('10')
  expect(body.msgBody.msgType).toBe(1)
  expect(calls.some((call) => call.uri.endsWith('/emoji/upload'))).toBe(false)
})
it('rejects invalid uploads before network access and cancels on account change', async () => {
  const { backend, fetcher, calls } = environment()
  expect((await backend.media(image({ kind: 'room', roomId: 'test' }))).ok).toBe(false)
  expect(
    (await backend.media({ ...image({ kind: 'sticker' }), file: { base64: 'bad input' } })).ok,
  ).toBe(false)
  expect(fetcher).not.toHaveBeenCalled()
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (url, options) => {
    if (String(url).startsWith('https://nosup-hz1.127.net/')) backend.close()
    return original(url, options)
  })
  expect((await backend.media(image({ kind: 'sticker' }))).ok).toBe(false)
  expect(calls.some((call) => call.uri.endsWith('/emoji/upload'))).toBe(false)
})
it('preserves long sticker IDs and requires confirmed deletion', async () => {
  const { backend, calls, fetcher } = environment()
  await backend.removeStickers(['12345678901234567890', '99', '99'])
  expect(calls[0]).toEqual({
    uri: '/api/social/emoji/cancel',
    data: { emojiIds: '[12345678901234567890,99]' },
  })
  await expect(backend.removeStickers(['1],bad'])).rejects.toThrow('ID 无效')
  fetcher.mockImplementation(
    async () =>
      new Response(JSON.stringify({ code: 200, data: { result: false, toast: '稍后重试' } })),
  )
  await expect(backend.removeStickers(['99'])).rejects.toThrow('稍后重试')
})
