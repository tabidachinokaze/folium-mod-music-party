import { afterEach, describe, expect, it, vi } from 'vitest'
import { PartyController } from '../src/client/controller'
import type { AccountConnection, FavoriteChange } from '../src/client/host'
import { createBackend } from '../src/main/backend'
import { fakeHost, rawSnapshot, song } from './fixtures'

// tests/red-heart.test.ts
const notifications = vi.hoisted(() => ({ receive: (_event: any) => {} }))
vi.mock('../src/client/match-channel', () => ({
  createMatchChannel: () => ({
    connect: vi.fn(async (receive) => {
      notifications.receive = receive
    }),
    arm: vi.fn(),
    confirmStart: vi.fn(),
    close: vi.fn(),
  }),
}))
const controllers: PartyController[] = []
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose())
  vi.useRealTimers()
})
const event = (): FavoriteChange => ({ song: song('1'), entryId: '101', liked: true })
function setup() {
  const host = fakeHost()
  const api = {
    connect: vi.fn(async () => ({ uid: '9', nickname: 'Listener' })),
    close: vi.fn(),
    call: vi.fn(async (method: string, _args?: unknown): Promise<any> => {
      if (method === 'multiStatus' || method === 'multiJoin')
        return { code: 200, data: { multiLtRoomSnapshot: rawSnapshot() } }
      return {
        code: 200,
        data: { success: true, failedCode: 0, songLists: [], records: [], page: { more: false } },
      }
    }),
  }
  const controller = new PartyController(host.folium, api as unknown as AccountConnection)
  controllers.push(controller)
  const favorite = () => host.bridge.acquire.mock.lastCall![0].onFavoriteChanged!
  const ready = async () => {
    await controller.connect()
    await controller.enter('restore')
    await vi.waitFor(() => expect(host.state.song?.id).toBe('1'))
    api.call.mockClear()
  }
  return { controller, host, api, favorite, ready }
}

describe('confirmed personal favorite room event', () => {
  it('sends room red-heart separately from repeatable room likes without changing playback or inventing a chat message', async () => {
    const { controller, host, api, favorite, ready } = setup()
    await ready()
    const playback = { ...host.state }
    const chat = controller.state.messages
    await favorite()(event())
    expect(api.call).toHaveBeenCalledExactlyOnceWith('multiRedHeart', {
      roomId: 'official_room',
      songId: '1',
      bizId: '101',
    })
    expect(host.state).toEqual(playback)
    expect(controller.state.messages).toBe(chat)
    expect(host.lease.release).not.toHaveBeenCalled()
    expect(
      api.call.mock.calls.some(([method]) => method === 'like' || method === 'multiLike'),
    ).toBe(false)
    await controller.likeCurrent()
    expect(api.call).toHaveBeenCalledWith('multiLike', {
      roomId: 'official_room',
      songId: '1',
      bizId: '101',
    })
  })

  it.each([
    ['unfavorite', { liked: false }],
    ['another occurrence of the same song', { entryId: '102' }],
    ['another song', { song: song('2') }],
    ['another provider', { song: { ...song('1'), source: 'qq' } }],
  ] as const)('ignores %s without a room mutation', async (_label, changed) => {
    const { api, favorite, ready } = setup()
    await ready()
    await favorite()({ ...event(), ...changed })
    expect(api.call).not.toHaveBeenCalled()
  })

  it('ignores audition even when the preview has the room song media ID', async () => {
    const { controller, host, api, favorite, ready } = setup()
    await ready()
    host.intent({ type: 'audition', song: song('1') })
    await vi.waitFor(() => expect(controller.state.auditioning).toBe(true))
    api.call.mockClear()
    await favorite()(event())
    expect(api.call).not.toHaveBeenCalled()
  })

  it('ignores a callback from a released session after restoring the same room and song', async () => {
    const { controller, api, favorite, ready } = setup()
    await ready()
    const old = favorite()
    controller.detach()
    await controller.enter('restore')
    api.call.mockClear()
    await old(event())
    expect(api.call).not.toHaveBeenCalled()
    await favorite()(event())
    expect(api.call).toHaveBeenCalledWith('multiRedHeart', {
      roomId: 'official_room',
      songId: '1',
      bizId: '101',
    })
  })

  it('rejects a callback after the account changes', async () => {
    const { controller, api, favorite, ready } = setup()
    await ready()
    controller.patch({ account: { uid: '10', nickname: 'Other listener' } })
    await favorite()(event())
    expect(api.call).not.toHaveBeenCalled()
  })

  it('keeps the player owned on room-event failure and reports that personal collection already succeeded without retrying', async () => {
    const { controller, host, api, favorite, ready } = setup()
    await ready()
    api.call.mockRejectedValueOnce(Object.assign(new Error('sync offline'), { code: 302 }))
    await favorite()(event())
    expect(host.folium.ui.toast).toHaveBeenCalledWith(
      '已加入我的喜欢，但房间红心动态同步失败：sync offline',
      expect.objectContaining({ type: 'error' }),
    )
    expect(api.call).toHaveBeenCalledTimes(1)
    expect(controller.state.room?.roomId).toBe('official_room')
    expect(controller.state.account?.uid).toBe('9')
    expect(host.lease.release).not.toHaveBeenCalled()
  })

  it('deduplicates pending callbacks and ignores a late failure after changing rooms', async () => {
    const { controller, host, api, favorite, ready } = setup()
    await ready()
    let fail!: (error: Error) => void
    api.call.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        }),
    )
    const first = favorite()(event())
    await favorite()(event())
    expect(api.call).toHaveBeenCalledTimes(1)
    controller.detach()
    host.folium.ui.toast = vi.fn()
    fail(new Error('old room failed'))
    await first
    expect(host.folium.ui.toast).not.toHaveBeenCalled()
  })

  it('does not register the optional observer with an older compatible host', async () => {
    const { host, ready } = setup()
    delete (host.bridge as { supportsFavoriteEvents?: true }).supportsFavoriteEvents
    await ready()
    expect(host.bridge.acquire.mock.lastCall![0].onFavoriteChanged).toBeUndefined()
  })

  it('accepts the favorite observer from a matched room with its new ownership epoch', async () => {
    vi.useFakeTimers()
    const { controller, host, api, favorite } = setup()
    host.state.song = song('1')
    api.call.mockImplementation(async (method) => ({
      code: 200,
      data: {
        success: true,
        failedCode: 0,
        multiLtRoomSnapshot: method === 'multiJoin' ? rawSnapshot() : null,
        songLists: [],
        records: [],
        page: { more: false },
      },
    }))
    await controller.connect()
    await controller.match()
    notifications.receive({ kind: 'ready', roomId: 'official_room' })
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.state.room?.roomId).toBe('official_room')
    api.call.mockClear()
    await favorite()(event())
    expect(api.call).toHaveBeenCalledWith('multiRedHeart', {
      roomId: 'official_room',
      songId: '1',
      bizId: '101',
    })
  })
})

function protocolEnvironment() {
  const requests: any[] = []
  let status = rawSnapshot()
  let result: any = { code: 200, data: { failedCode: 0 } }
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const body = JSON.parse(String(init?.body))
    requests.push(body)
    const response = (value: unknown) => new Response(JSON.stringify(value))
    if (String(url).includes('/register/checktoken/v3'))
      return response({ code: 200, token: 'test-token' })
    if (body.uri.endsWith('/status/get'))
      return response({ code: 200, data: { multiLtRoomSnapshot: status } })
    return response(result)
  })
  const backend = createBackend(fetcher)
  backend.connect('MUSIC_U=test-only', 4176)
  return {
    backend,
    requests,
    fetcher,
    setStatus: (value: typeof status) => {
      status = value
    },
    setResult: (value: any) => {
      result = value
    },
  }
}
const request = {
  method: 'multiRedHeart' as const,
  args: { roomId: 'official_room', songId: '1', bizId: '101' },
}
describe('official red-heart protocol', () => {
  it('sends the official REDHEART=5 payload through eapi with the exact current occurrence and checkToken', async () => {
    const { backend, requests } = protocolEnvironment()
    expect((await backend.call(request)).ok).toBe(true)
    expect(requests.at(-1)).toMatchObject({
      uri: '/api/listen/together/multi/match/song/operate',
      crypto: 'eapi',
      data: {
        roomId: 'official_room',
        songId: '1',
        bizId: '101',
        checkToken: 'test-token',
        operate: 5,
      },
    })
    expect(requests.some((item) => item.uri?.endsWith('/like'))).toBe(false)
    backend.close()
  })

  it.each([
    { code: 200 },
    { code: 200, data: { result: true } },
    { code: 200, data: { failedCode: 10006 } },
    { code: 200, data: { failedCode: 0, result: false } },
  ])('requires explicit failedCode 0 without a contradictory failure: %j', async (result) => {
    const { backend, setResult } = protocolEnvironment()
    setResult(result)
    expect((await backend.call(request)).ok).toBe(false)
    backend.close()
  })

  it.each(['room', 'occurrence', 'song'] as const)(
    'checks the live %s before issuing the red-heart mutation',
    async (changed) => {
      const { backend, requests, setStatus } = protocolEnvironment()
      const state = rawSnapshot()
      if (changed === 'room') state.roomId = 'other_room'
      if (changed === 'occurrence') state.roomPlaySongInfo.playSong.songBizId = '102'
      if (changed === 'song') state.roomPlaySongInfo.playSong.songId = '2'
      setStatus(state)
      expect((await backend.call(request)).ok).toBe(false)
      expect(requests.some((item) => item.uri?.endsWith('/song/operate'))).toBe(false)
      expect(requests).toHaveLength(1)
      backend.close()
    },
  )

  it('does not use a previous account after status resolves', async () => {
    const { backend, requests, fetcher } = protocolEnvironment()
    const original = fetcher.getMockImplementation()!
    fetcher.mockImplementationOnce(async (url, init) => {
      const result = await original(url, init)
      backend.connect('MUSIC_U=other-test-account', 4176)
      return result
    })
    expect((await backend.call(request)).ok).toBe(false)
    expect(requests.some((item) => item.uri?.endsWith('/song/operate'))).toBe(false)
    backend.close()
  })
})
