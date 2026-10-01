import { afterEach, expect, it, vi } from 'vitest'
import { createBackend } from '../src/main/backend'
import { uploadImage } from '../src/client/private-tools'
import type { PartyController } from '../src/client/controller'

// tests/room-media.test.ts
const encoded = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const request = (roomId = 'official_room') => ({
  requestId: '12345678-1234-1234-1234-123456789012',
  target: { kind: 'room', roomId },
  file: {
    kind: 'image',
    name: 'custom.gif',
    mime: 'image/gif',
    width: 1,
    height: 1,
    base64: encoded,
  },
})
function environment() {
  const state = { roomId: 'official_room', onUpload: () => {} },
    calls: { uri: string; data: any }[] = []
  const response = (body: unknown) => new Response(JSON.stringify(body))
  const fetcher = vi.fn(async (url: any, options: any) => {
    if (String(url).startsWith('https://nosup-hz1.127.net/')) {
      state.onUpload()
      return response({})
    }
    const args = JSON.parse(options.body),
      uri = args.uri || new URL(url).pathname
    calls.push({ uri, data: args.data })
    if (uri === '/login/status') return response({ code: 200, data: { profile: { userId: 9 } } })
    if (uri === '/api/listen/together/multi/match/status/get')
      return response({
        code: 200,
        data: {
          multiLtRoomSnapshot: {
            roomId: state.roomId,
            multiRoomInfoDTO: { chatRoomId: '888' },
          },
        },
      })
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
    if (uri === '/api/middle/im/chatroom/send') return response({ code: 200 })
    throw new Error(`Unexpected test endpoint: ${uri}`)
  })
  const backend = createBackend(fetcher as typeof fetch)
  backend.connect('MUSIC_U=test', 4176)
  return { backend, fetcher, calls, state }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('rechecks the room before and after upload, sends one image and deduplicates its request', async () => {
  const { backend, calls } = environment(),
    image = request()
  const replies = await Promise.all([backend.media(image), backend.media(image)])
  expect(replies.every((reply) => reply.ok)).toBe(true)
  expect((await backend.media(image)).ok).toBe(true)
  expect(calls.filter(({ uri }) => uri.endsWith('/status/get'))).toHaveLength(2)
  expect(calls.filter(({ uri }) => uri.endsWith('/token/alloc'))).toHaveLength(1)
  const sends = calls.filter(({ uri }) => uri.endsWith('/chatroom/send'))
  expect(sends).toHaveLength(1)
  expect(sends[0].data.chatroomId).toBe('888')
  expect(JSON.parse(sends[0].data.clientExt)).toMatchObject({
    roomId: 'official_room',
    ltType: 'MULTI_MATCH_SONG',
    emoji: {
      emojiId: '0',
      emojiName: 'custom.gif',
      emojiImgUrl: 'https://p1.music.126.net/fixture.gif',
    },
  })
  expect(JSON.parse(sends[0].data.msgBody)).toEqual({ msg: '[custom.gif]', msgType: 0 })
  expect(calls.some(({ uri }) => /communication|emoji\/upload/.test(uri))).toBe(false)
  const count = calls.length
  expect(await backend.media(request('other_room'))).toMatchObject({
    ok: false,
    error: '附件请求标识已被使用',
  })
  expect(calls).toHaveLength(count)
})

it('rejects an invalid or no-longer-current room before uploading', async () => {
  const { backend, calls, state, fetcher } = environment()
  expect((await backend.media(request('../bad'))).ok).toBe(false)
  expect(fetcher).not.toHaveBeenCalled()
  state.roomId = 'other_room'
  expect(await backend.media(request())).toMatchObject({
    ok: false,
    error: '账号已离开这个房间，附件未发送',
  })
  expect(calls.some(({ uri }) => /token\/alloc|chatroom\/send/.test(uri))).toBe(false)
})

it('does not send an uploaded image after the account leaves the captured room', async () => {
  const { backend, calls, state } = environment()
  state.onUpload = () => {
    state.roomId = 'new_room'
  }
  expect(await backend.media(request())).toMatchObject({
    ok: false,
    error: '账号已离开这个房间，附件未发送',
  })
  expect(calls.filter(({ uri }) => uri.endsWith('/status/get'))).toHaveLength(2)
  expect(calls.some(({ uri }) => uri.endsWith('/chatroom/send'))).toBe(false)
})

it('stops an old-account upload before room delivery when the Folia account changes', async () => {
  const { backend, calls, state } = environment()
  state.onUpload = () => backend.connect('MUSIC_U=another-account', 4176)
  expect(await backend.media(request())).toMatchObject({
    ok: false,
    error: '账号已变化，请重新发送附件',
  })
  expect(calls.some(({ uri }) => uri.endsWith('/chatroom/send'))).toBe(false)
})

it('does not send or retry automatically when uploading fails', async () => {
  const { backend, calls, state } = environment()
  state.onUpload = () => {
    throw new Error('storage unavailable')
  }
  const image = request()
  expect((await backend.media(image)).ok).toBe(false)
  expect((await backend.media(image)).ok).toBe(false)
  expect(calls.filter(({ uri }) => uri.endsWith('/token/alloc'))).toHaveLength(1)
  expect(calls.some(({ uri }) => uri.endsWith('/chatroom/send'))).toBe(false)
})

it.each(['room', 'account'] as const)(
  'rejects a %s change while the selected image is being read',
  async (change) => {
    const state = { account: { uid: '9' }, room: { roomId: 'official_room' } },
      attachment = vi.fn(),
      controller = { state, connection: { attachment } } as unknown as PartyController
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        naturalWidth = 1
        naturalHeight = 1
        async decode() {}
      },
    )
    vi.stubGlobal(
      'FileReader',
      class {
        result = `data:image/gif;base64,${encoded}`
        onload = () => {}
        readAsDataURL() {
          if (change === 'room') state.room = { roomId: 'another_room' }
          else state.account = { uid: '10' }
          this.onload()
        }
      },
    )
    await expect(
      uploadImage(
        controller,
        new File([Buffer.from(encoded, 'base64')], 'custom.gif', { type: 'image/gif' }),
        { kind: 'room', roomId: 'official_room' },
      ),
    ).rejects.toThrow(change === 'room' ? '房间已变化' : '账号已变化')
    expect(attachment).not.toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:test')
  },
)
