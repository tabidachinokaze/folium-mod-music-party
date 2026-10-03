import { afterEach, expect, it, vi } from 'vitest'
import { PartyController } from '../src/client/controller'
import type { AccountConnection } from '../src/client/host'
import { createBackend } from '../src/main/backend'
import type { Method } from '../vendor/music-party/src/shared/types'
import { fakeHost, rawSnapshot, song } from './fixtures'

// tests/room-recovery.test.ts
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
const empty = () => ({
  code: 200,
  data: { success: true, songLists: [], records: [], page: { more: false } },
})
function setup() {
  const host = fakeHost()
  host.state.song = song('22')
  const api = {
    connect: vi.fn(async () => ({ uid: '9', nickname: 'Listener' })),
    close: vi.fn(),
    call: vi.fn(async (_method: string, _args?: any): Promise<any> => empty()),
  }
  const controller = new PartyController(host.folium, api as unknown as AccountConnection)
  controllers.push(controller)
  return { host, api, controller }
}
function status(room = rawSnapshot()) {
  return { code: 200, data: { status: 'RECONNECT_SUCCESS', multiLtRoomSnapshot: room } }
}

it.each(['create', 'join'] as const)(
  'preserves a discovered room when refusing %s and never acquires playback',
  async (kind) => {
    const { controller, api, host } = setup()
    await controller.connect()
    api.call.mockResolvedValueOnce(status())
    await controller.run(() =>
      controller.enter(
        kind,
        'https://st.music.163.com/listen-together/multishare/index.html?roomId=invite_room&inviterUid=8',
      ),
    )
    expect(controller.state.room).toBeNull()
    expect(controller.state.availableRoom?.roomId).toBe('official_room')
    expect(controller.state.error).toContain('已经在多人房间')
    expect(
      api.call.mock.calls.some(([method]) => method === 'multiCreate' || method === 'multiJoin'),
    ).toBe(false)
    expect(host.bridge.acquire).not.toHaveBeenCalled()
    expect(host.state.song?.id).toBe('22')
  },
)

it.each(['restore', 'create'] as const)(
  'keeps a recoverable room when %s cannot acquire the player',
  async (kind) => {
    const { controller, api, host } = setup()
    await controller.connect()
    api.call.mockImplementation(async (method) =>
      (kind === 'restore' && method === 'multiStatus') || method === 'multiCreate'
        ? status()
        : empty(),
    )
    host.bridge.acquire.mockImplementationOnce(() => {
      throw new Error('external-playback-context-unavailable')
    })
    await controller.run(() => controller.enter(kind))
    expect(controller.state.room).toBeNull()
    expect(controller.state.availableRoom?.roomId).toBe('official_room')
    expect(host.lease.play).not.toHaveBeenCalled()
    expect(host.state.song?.id).toBe('22')
  },
)

it.each(['create', 'join'] as const)(
  'reconciles a failed %s response with status without repeating the write',
  async (kind) => {
    const { controller, api, host } = setup()
    await controller.connect()
    let joined = false
    api.call.mockImplementation(async (method) => {
      if (method === 'multiCreate' || method === 'multiJoin') {
        joined = true
        throw new Error('response lost')
      }
      return method === 'multiStatus' && joined ? status() : empty()
    })
    await controller.run(() =>
      controller.enter(
        kind,
        'https://st.music.163.com/listen-together/multishare/index.html?roomId=invite_room&inviterUid=8',
      ),
    )
    expect(controller.state.availableRoom?.roomId).toBe('official_room')
    expect(controller.state.error).toBe('response lost')
    expect(
      api.call.mock.calls.filter(([method]) => method === 'multiCreate' || method === 'multiJoin'),
    ).toHaveLength(1)
    expect(host.bridge.acquire).not.toHaveBeenCalled()
  },
)

it('keeps a matched and acknowledged room recoverable when local takeover fails', async () => {
  vi.useFakeTimers()
  const { controller, api, host } = setup()
  await controller.connect()
  api.call.mockImplementation(async (method) => (method === 'multiJoin' ? status() : empty()))
  host.bridge.acquire.mockImplementationOnce(() => {
    throw new Error('external-playback-context-unavailable')
  })
  await controller.match()
  notifications.receive({ kind: 'ready', roomId: 'official_room' })
  await vi.advanceTimersByTimeAsync(0)
  expect(controller.state.matching).toBe(false)
  expect(controller.state.room).toBeNull()
  expect(controller.state.availableRoom?.roomId).toBe('official_room')
  expect(host.state.song?.id).toBe('22')
})

it('discovers server membership after a failed match request instead of leaving only an error toast', async () => {
  const { controller, api, host } = setup()
  await controller.connect()
  let alreadyJoined = false
  api.call.mockImplementation(async (method) => {
    if (method === 'multiMatch') {
      alreadyJoined = true
      throw new Error('already in room')
    }
    return method === 'multiStatus' && alreadyJoined ? status() : empty()
  })
  await controller.match()
  await vi.waitFor(() => expect(controller.state.availableRoom?.roomId).toBe('official_room'))
  expect(controller.state.matching).toBe(false)
  expect(host.bridge.acquire).not.toHaveBeenCalled()
})

it('clears expired login after a match request returns 302', async () => {
  const { controller, api } = setup()
  await controller.connect()
  api.call.mockImplementation(async (method) => {
    if (method === 'multiMatch') throw Object.assign(new Error('expired'), { code: 302 })
    return empty()
  })
  await controller.match()
  expect(controller.state.account).toBeNull()
  expect(controller.state.availableRoom).toBeNull()
  expect(controller.state.matching).toBe(false)
})

it('does not start matching when membership preflight fails', async () => {
  const { controller, api, host } = setup()
  await controller.connect()
  api.call.mockClear()
  api.call.mockRejectedValueOnce(new Error('offline'))
  await controller.match()
  expect(api.call).toHaveBeenCalledExactlyOnceWith('multiStatus')
  expect(controller.state.matching).toBe(false)
  expect(controller.state.error).toContain('offline')
  expect(host.bridge.acquire).not.toHaveBeenCalled()
})

it('retains the newly discovered room when the account has switched rooms remotely', async () => {
  const { controller, api } = setup()
  api.call.mockImplementation(async (method) => (method === 'multiStatus' ? status() : empty()))
  await controller.connect()
  await controller.enter('restore')
  api.call.mockResolvedValueOnce(status({ ...rawSnapshot(), roomId: 'other_room' }))
  await controller.refresh()
  expect(controller.state.room).toBeNull()
  expect(controller.state.availableRoom?.roomId).toBe('other_room')
})

it('freezes the pre-room default so subsequent room playback cannot replace the matching seed', async () => {
  const { controller, api, host } = setup()
  api.call.mockImplementation(async (method) => (method === 'multiStatus' ? status() : empty()))
  await controller.connect()
  expect(controller.getMatchSong()?.id).toBe('22')
  await controller.enter('restore')
  await vi.waitFor(() => expect(host.state.song?.id).toBe('1'))
  expect(controller.getMatchSong()?.id).toBe('22')
  api.call.mockImplementation(async () => empty())
  await controller.match()
  expect(api.call).toHaveBeenCalledWith('multiMatch', { songId: '22' })
})

it('deduplicates room discovery and ignores responses from an account that has changed', async () => {
  const { controller, api } = setup()
  await controller.connect()
  let resolve!: (value: any) => void
  api.call.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const first = controller.checkAvailableRoom()
  api.call.mockClear()
  expect(await controller.checkAvailableRoom()).toBe(false)
  expect(api.call).not.toHaveBeenCalled()
  controller.patch({ account: { uid: '10', nickname: 'New account' } })
  resolve(status())
  expect(await first).toBe(false)
  expect(controller.state.availableRoom).toBeNull()
  expect(controller.state.checkingRoom).toBe(false)
})

it('does not apply a late login error to a new account', async () => {
  const { controller, api } = setup()
  await controller.connect()
  let reject!: (error: unknown) => void
  api.call.mockImplementationOnce(
    () =>
      new Promise((_done, fail) => {
        reject = fail
      }),
  )
  const pending = controller.checkAvailableRoom()
  controller.patch({ account: { uid: '10', nickname: 'New account' } })
  reject(Object.assign(new Error('expired old account'), { code: 302 }))
  await pending
  expect(controller.state.account?.uid).toBe('10')
  expect(controller.state.error).toBe('')
})

it('does not write a room after a pending entry preflight belongs to a previous account', async () => {
  const { controller, api, host } = setup()
  await controller.connect()
  let resolve!: (value: any) => void
  api.call.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const pending = controller.enter('create')
  controller.patch({ account: { uid: '10', nickname: 'New account' } })
  api.call.mockClear()
  resolve(empty())
  await pending
  expect(api.call).not.toHaveBeenCalled()
  expect(host.bridge.acquire).not.toHaveBeenCalled()
  expect(controller.state.availableRoom).toBeNull()
})

it('submits a normal exit then the selected matching seed through the real backend protocol mapping', async () => {
  const { controller, api, host } = setup()
  const requests: any[] = []
  let joined = true
  const backend = createBackend(async (url, init) => {
    const body = JSON.parse(String(init?.body))
    const reply = (value: unknown) =>
      new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
    if (String(url).includes('/register/checktoken/v3'))
      return reply({ code: 200, token: 'test-token' })
    requests.push(body)
    if (body.uri.endsWith('/exit')) {
      joined = false
      host.state.song = song('99') // the current playback is not the selected seed
    }
    return reply(body.uri.endsWith('/status/get') && joined ? status() : empty())
  })
  backend.connect('MUSIC_U=test-only', 30123)
  api.call.mockImplementation(async (method, args) => {
    const reply = await backend.call({ method: method as Method, args })
    if (!reply.ok) throw new Error(reply.error)
    return reply.data
  })
  try {
    await controller.connect()
    await controller.enter('restore')
    await vi.waitFor(() => expect(host.state.song?.id).toBe('1'))
    controller.selectMatchSong(song('42'))
    requests.length = 0
    await controller.match()
    const exit = requests.findIndex((request) => request.uri.endsWith('/exit'))
    const check = requests.findIndex((request) => request.uri.endsWith('/status/get'))
    const match = requests.findIndex((request) => request.uri.endsWith('/multi/match'))
    expect(exit).toBeGreaterThanOrEqual(0)
    expect(check).toBeGreaterThan(exit)
    expect(match).toBeGreaterThan(check)
    expect(requests[exit].data).toEqual({ roomId: 'official_room', exitType: 'NORMAL_END' })
    expect(requests[match]).toMatchObject({
      crypto: 'eapi',
      data: { songId: '42', checkToken: 'test-token' },
    })
    expect(host.state.song?.id).toBe('99')
    expect(controller.state.matching).toBe(true)
  } finally {
    controller.dispose()
    backend.close()
  }
})
