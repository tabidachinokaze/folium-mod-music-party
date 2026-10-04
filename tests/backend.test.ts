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

it('starts background notifications only after a verified account and retains them when matching closes', async () => {
  const transport = { open: vi.fn(async () => {}), poll: vi.fn(() => []), close: vi.fn() }
  const make = vi.fn(() => transport)
  const fetcher = vi.fn(async (url: any) =>
    String(url).includes('/login/status')
      ? response({ code: 200, data: { profile: { userId: 9 } } })
      : response({ code: 200, data: { accId: '9', token: 'fake-mini-token' } }),
  )
  const backend = createBackend(fetcher as typeof fetch, make)
  backend.connect('MUSIC_U=fake-session', 4176)
  expect(fetcher).not.toHaveBeenCalled()
  expect(make).not.toHaveBeenCalled()
  const result = await backend.call({ method: 'account' })
  expect(result.ok).toBe(true)
  await backend.matchOpen('matching-attempt-one')
  expect(make).toHaveBeenCalledOnce()
  expect(transport.open).toHaveBeenCalledOnce()
  backend.matchClose('matching-attempt-one')
  const feed = backend.privateNotificationsPoll(0)
  expect(feed.connected).toBe(true)
  expect(feed.events[0].notice.kind).toBe('sync')
  expect(transport.close).not.toHaveBeenCalled()
  backend.connect('MUSIC_U=other-session', 4176)
  expect(transport.close).toHaveBeenCalledOnce()
  expect(backend.privateNotificationsPoll(feed.cursor, feed.session)).toMatchObject({
    reset: true,
    connected: false,
    events: [],
  })
  backend.close()
})

it('does not open background notifications for an anonymous profile or a stale account response', async () => {
  const transport = { open: vi.fn(async () => {}), poll: vi.fn(() => []), close: vi.fn() }
  const make = vi.fn(() => transport)
  let resolve!: (value: Response) => void
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((done) => {
        resolve = done
      }),
  )
  const backend = createBackend(fetcher as typeof fetch, make)
  backend.connect('MUSIC_U=fake-session', 4176)
  const anonymous = backend.call({ method: 'account' })
  resolve(response({ code: 200, data: { profile: null } }))
  expect((await anonymous).ok).toBe(true)
  expect(make).not.toHaveBeenCalled()
  const stale = backend.call({ method: 'account' })
  backend.connect('MUSIC_U=other-session', 4176)
  resolve(response({ code: 200, data: { profile: { userId: 9 } } }))
  expect((await stale).ok).toBe(false)
  expect(make).not.toHaveBeenCalled()
  backend.close()
})

it('restores the verified background subscription when only the local API port changes', async () => {
  const transports: {
    open: ReturnType<typeof vi.fn>
    poll: () => []
    close: ReturnType<typeof vi.fn>
  }[] = []
  const make = () => {
    const transport = { open: vi.fn(async () => {}), poll: () => [] as [], close: vi.fn() }
    transports.push(transport)
    return transport
  }
  const backend = createBackend(
    async (url) =>
      String(url).includes('/login/status')
        ? response({ code: 200, data: { profile: { userId: 9 } } })
        : response({ code: 200, data: { accId: '9', token: 'fake-mini-token' } }),
    make,
  )
  backend.connect('MUSIC_U=fake-session', 4176)
  await backend.call({ method: 'account' })
  await backend.matchOpen('matching-attempt-one')
  backend.matchClose('matching-attempt-one')
  backend.connect('MUSIC_U=fake-session', 4177)
  await vi.waitFor(() => expect(backend.privateNotificationsPoll(0).connected).toBe(true))
  expect(transports).toHaveLength(2)
  expect(transports[0].close).toHaveBeenCalledOnce()
  expect(transports[1].open).toHaveBeenCalledOnce()
  backend.connect('MUSIC_U=other-session', 4177)
  expect(transports).toHaveLength(2)
  expect(backend.privateNotificationsPoll(0).connected).toBe(false)
  backend.close()
})

describe('private peer profile boundary', () => {
  it.each([true, false, undefined, null, 'true', 1])(
    'returns only a narrow profile and an explicit online boolean (%s)',
    async (online) => {
      const fetcher = vi.fn(async () =>
        response({
          code: 200,
          cookie: 'MUSIC_U=server-only',
          data: {
            online,
            liveOnline: true,
            personalHomepage: {
              userProfileData: {
                userId: 8,
                nickname: '\0Peer\n',
                avatarUrl: 'http://p1.music.126.net/avatar.png',
                lastLoginIP: 'private-ip',
              },
            },
          },
        }),
      )
      const backend = createBackend(fetcher)
      backend.connect('MUSIC_U=test-only', 30123)
      expect(await backend.privatePeer('8')).toEqual({
        uid: '8',
        nickname: 'Peer',
        avatar: 'https://p1.music.126.net/avatar.png',
        online: typeof online === 'boolean' ? online : null,
      })
      const [url, init] = vi.mocked(fetcher).mock.calls[0] as unknown as [URL, RequestInit]
      expect(url.pathname).toBe('/api')
      expect(init.headers).toMatchObject({ 'x-apicache-bypass': 'true' })
      expect(JSON.parse(String(init.body))).toMatchObject({
        uri: '/api/communication/msg/setting/get',
        crypto: 'eapi',
        data: { userId: '8', scene: 1 },
        cookie: 'MUSIC_U=test-only',
      })
      backend.close()
    },
  )

  it('does not reuse a cached status or infer online from other fields', async () => {
    const fetcher = vi.fn(async (_url: any, _init: any) =>
      response({ code: 200, data: { liveOnline: true, followed: true } }),
    )
    const backend = createBackend(fetcher)
    backend.connect('MUSIC_U=test-only', 30123)
    const expected = { uid: '8', nickname: '', avatar: '', online: null }
    expect(await backend.privatePeer('8')).toEqual(expected)
    expect(await backend.privatePeer('8')).toEqual(expected)
    expect(String(fetcher.mock.calls[0][0])).not.toBe(String(fetcher.mock.calls[1][0]))
    backend.close()
  })

  it('rejects malformed peer IDs before any request and requires an account', async () => {
    const fetcher = vi.fn()
    const backend = createBackend(fetcher)
    await expect(backend.privatePeer('8')).rejects.toThrow('连接')
    backend.connect('MUSIC_U=test-only', 30123)
    for (const uid of [0, 8, null, {}, '', '0', '-1', '01', '8.0', '1'.repeat(25), '8&scene=2'])
      await expect(backend.privatePeer(uid as string)).rejects.toThrow('ID 无效')
    expect(fetcher).not.toHaveBeenCalled()
    backend.close()
  })

  it.each(['switch', 'disconnect'])('rejects a late response after account %s', async (action) => {
    let resolve!: (value: Response) => void
    const backend = createBackend(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        }),
    )
    backend.connect('MUSIC_U=first-test-account', 30123)
    const pending = backend.privatePeer('8')
    if (action === 'switch') backend.connect('MUSIC_U=second-test-account', 30123)
    else backend.close()
    resolve(response({ code: 200, data: { online: true } }))
    await expect(pending).rejects.toThrow('账号已变化')
    backend.close()
  })

  it.each([200, 401])(
    'keeps authentication codes but strips raw HTTP error bodies (%i)',
    async (status) => {
      const backend = createBackend(
        async () =>
          new Response(
            JSON.stringify({
              code: 302,
              message: 'MUSIC_U=do-not-export',
              cookie: 'MUSIC_U=do-not-export',
            }),
            { status, headers: { 'Content-Type': 'application/json' } },
          ),
      )
      backend.connect('MUSIC_U=test-only', 30123)
      const error = (await backend.privatePeer('8').catch((value: unknown) => value)) as Error & {
        code: number
      }
      expect(error.code).toBe(302)
      expect(error.message).not.toContain('MUSIC_U')
      expect(error).not.toHaveProperty('body')
      backend.close()
    },
  )

  it('rejects a mismatched profile and omits untrusted avatar addresses', async () => {
    let userId = 7
    const backend = createBackend(async () =>
      response({
        code: 200,
        data: {
          online: true,
          personalHomepage: {
            userProfileData: { userId, nickname: 'Peer', avatarUrl: 'javascript:alert(1)' },
          },
        },
      }),
    )
    backend.connect('MUSIC_U=test-only', 30123)
    await expect(backend.privatePeer('8')).rejects.toThrow('不匹配')
    userId = 8
    expect(await backend.privatePeer('8')).toEqual({
      uid: '8',
      nickname: 'Peer',
      avatar: '',
      online: true,
    })
    backend.close()
  })
})
