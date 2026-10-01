import { describe, expect, it, vi } from 'vitest'
import { createBackend } from '../src/main/backend'
import { loadQueue } from '../src/client/room-data'
import { AccountConnection } from '../src/client/host'
import { fakeHost, rawSnapshot } from './fixtures'

// tests/backend.test.ts
const response = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
describe('plugin protocol boundary', () => {
  it('uses the bundled local API, eapi and checktoken; preserves HTTP-200 business errors', async () => {
    const requests: any[] = []
    const fetcher = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body)
      requests.push(body)
      if (String(_url).includes('/register/checktoken/v3'))
        return response({ code: 200, token: 'test-token' })
      return response({
        code: 200,
        data: { success: false, failedType: 'MULTI_SONG_NOT_SATISFIED' },
      })
    })
    const backend = createBackend(fetcher as typeof fetch)
    backend.connect('MUSIC_U=test-only', 30123)
    const reply = await backend.call({ method: 'multiCreate', args: { songId: '1' } })
    expect(reply.ok).toBe(false)
    expect(reply.error).toContain('开房条件')
    expect(requests.at(-1)).toMatchObject({
      crypto: 'eapi',
      data: { songId: '1', checkToken: 'test-token' },
    })
    expect(JSON.stringify(reply)).not.toContain('test-token')
    expect(JSON.stringify(reply)).not.toContain('MUSIC_U')
    backend.close()
  })
  it('rejects unrestricted endpoints and protects removal of another member’s recommendation', async () => {
    const fetcher = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body)
      if (String(_url).includes('/login/status'))
        return response({ code: 200, data: { profile: { userId: 9 } } })
      if (body.uri?.endsWith('status/get'))
        return response({ code: 200, data: { multiLtRoomSnapshot: rawSnapshot() } })
      return response({
        code: 200,
        data: {
          songLists: [{ songInfo: { resourceId: '2', bizId: '102' }, rcmdUid: '99' }],
          page: { more: false },
        },
      })
    })
    const backend = createBackend(fetcher as typeof fetch)
    backend.connect('MUSIC_U=test-only', 30123)
    expect((await backend.call({ method: 'api' as any })).ok).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
    const reply = await backend.call({
      method: 'multiRemove',
      args: { roomId: 'official_room', songId: '2', bizId: '102' },
    })
    expect(reply.error).toContain('只能删除自己')
    backend.close()
  })
  it('loads all queue pages, keeps repeated song IDs with distinct business IDs and detects cursor loops', async () => {
    const call = vi.fn(async (_method, args) => ({
      data: {
        songLists: Array.from({ length: 5 }, (_, i) => ({
          songInfo: { resourceId: '10', bizId: String((args.cursor ? 5 : 0) + i + 1), title: '歌' },
          rcmdUid: '9',
        })),
        page: args.cursor ? { more: false } : { more: true, cursor: 'second' },
      },
    }))
    expect(await loadQueue(call, 'room', () => true)).toHaveLength(10)
    const stuck = vi.fn(async () => ({
      data: { songLists: [], page: { more: true, cursor: 'same' } },
    }))
    await expect(loadQueue(stuck, 'room', () => true)).rejects.toThrow('分页异常')
  })
  it('rejects an account switch before sending a room mutation', async () => {
    const { folium } = fakeHost()
    let cookie = 'MUSIC_U=first'
    folium.rpc.call = vi.fn(async (name) =>
      name === 'call' ? { ok: true, data: { data: { profile: { userId: 9 } } } } : undefined,
    ) as any
    const connection = new AccountConnection(
      folium,
      () => cookie,
      async () => 30000,
    )
    await connection.connect()
    vi.mocked(folium.rpc.call).mockClear()
    cookie = 'MUSIC_U=second'
    await expect(connection.call('multiNext', { roomId: 'room' })).rejects.toThrow('账号已变化')
    expect(folium.rpc.call).not.toHaveBeenCalled()
    connection.close()
  })
})

it('maps stranger creation and rematching to the official parameters', async () => {
  const { multiPayload } = await import('../vendor/music-party/src/main/multi-api')
  expect(multiPayload('multiCreate', { songId: '1' }).type).toBe(1)
  expect(multiPayload('multiCreate', { songId: '1', allowStrangerMatch: true }).type).toBe(2)
  expect(multiPayload('multiMatch', { songId: '1' }, 'token')).toEqual({
    songId: '1',
    checkToken: 'token',
  })
  expect(multiPayload('multiRematchLeave', { roomId: 'r' })).toEqual({
    roomId: 'r',
    exitType: 'CHANGE_ROOM',
  })
})

it('keeps notification credentials in main and closes only the matching attempt', async () => {
  const requests: any[] = []
  const transport = { open: vi.fn(async () => {}), poll: vi.fn(() => []), close: vi.fn() }
  const backend = createBackend(
    async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)))
      return response({ code: 200, data: { accId: '9', token: 'fake-mini-token' } })
    },
    () => transport,
  )
  backend.connect('MUSIC_U=fake-session', 4176)
  expect(await backend.matchOpen('matching-attempt-one')).toBeUndefined()
  expect(transport.open).toHaveBeenCalledWith({ accId: '9', token: 'fake-mini-token' })
  expect(requests[0]).toMatchObject({
    uri: '/api/middle/im/token/get',
    crypto: 'eapi',
    data: { bizTag: 'platform' },
  })
  backend.matchClose('stale-attempt-id')
  expect(transport.close).not.toHaveBeenCalled()
  expect(backend.matchPoll('matching-attempt-one')).toEqual([])
  backend.connect('MUSIC_U=other-session', 4176)
  expect(transport.close).toHaveBeenCalledOnce()
  expect(() => backend.matchPoll('matching-attempt-one')).toThrow('关闭')
  backend.close()
  await expect(backend.matchOpen('matching-attempt-two')).rejects.toThrow('登录')
})

it('does not open a notification socket when cancelled during credential fetch', async () => {
  let resolve!: (response: Response) => void
  const transport = { open: vi.fn(async () => {}), poll: vi.fn(() => []), close: vi.fn() }
  const backend = createBackend(
    () =>
      new Promise((r) => {
        resolve = r
      }),
    () => transport,
  )
  backend.connect('MUSIC_U=fake-session', 4176)
  const pending = backend.matchOpen('matching-attempt-one')
  backend.matchClose('matching-attempt-one')
  resolve(response({ code: 200, data: { accId: '9', token: 'fake-mini-token' } }))
  await expect(pending).rejects.toThrow('取消')
  expect(transport.open).not.toHaveBeenCalled()
  backend.close()
})
