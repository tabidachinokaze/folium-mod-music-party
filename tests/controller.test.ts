import { afterEach, describe, expect, it, vi } from 'vitest'
import { PartyController } from '../src/client/controller'
import type { AccountConnection } from '../src/client/host'
import { fakeHost, rawSnapshot, song } from './fixtures'

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
// tests/controller.test.ts
afterEach(() => vi.useRealTimers())
function setup() {
  const host = fakeHost()
  const api = {
    connect: vi.fn(async () => ({ uid: '9', nickname: '测试账号' })),
    close: vi.fn(),
    attachment: vi.fn(async () => ({ accId: '9', token: 'fake' })),
    call: vi.fn(async (method: string) => {
      if (method === 'multiStatus')
        return { code: 200, data: { multiLtRoomSnapshot: rawSnapshot() } }
      if (method === 'multiQueue')
        return { code: 200, data: { songLists: [], page: { more: false } } }
      if (method === 'multiChatHistory')
        return { code: 200, data: { records: [], page: { more: false } } }
      return { code: 200, data: { success: true } }
    }),
  }
  return {
    host,
    api,
    controller: new PartyController(host.folium, api as unknown as AccountConnection, () => 1000),
  }
}
describe('official multiplayer controller', () => {
  it('forwards all explicitly enqueued songs and never treats audio failure as a room skip', async () => {
    const { controller, host, api } = setup()
    await controller.connect()
    await controller.enter('restore')
    api.call.mockClear()
    host.intent({
      type: 'enqueue',
      songs: ['12', '13'].map((id) => ({
        id,
        source: 'netease',
        ref: id,
        title: '',
        artist: '',
        album: null,
      })),
    })
    await vi.waitFor(() =>
      expect(api.call.mock.calls.filter(([method]) => method === 'multiAdd')).toHaveLength(2),
    )
    expect(api.call).toHaveBeenCalledWith('multiAdd', { roomId: 'official_room', songId: '13' })
    host.intent({ type: 'playback-error' })
    expect(api.call.mock.calls.some(([method]) => method === 'multiNext')).toBe(false)
    expect(controller.state.error).toContain('播放失败')
    controller.dispose()
  })
  it('restores a room; a natural end polls status while an explicit next requests SWITCH', async () => {
    vi.useFakeTimers()
    const { controller, host, api } = setup()
    await controller.connect()
    await controller.enter('restore')
    expect(controller.state.room?.onlineCount).toBe(3)
    api.call.mockClear()
    host.intent({ type: 'ended' })
    await vi.advanceTimersByTimeAsync(150)
    expect(api.call.mock.calls.some(([method]) => method === 'multiNext')).toBe(false)
    host.intent({ type: 'next' })
    await vi.advanceTimersByTimeAsync(1)
    expect(api.call.mock.calls.some(([method]) => method === 'multiNext')).toBe(true)
    controller.dispose()
  })
  it('auditions play selections locally and recommends only explicit Netease enqueue', async () => {
    const { controller, host, api } = setup()
    await controller.connect()
    await controller.enter('restore')
    api.call.mockClear()
    host.intent({
      type: 'play',
      song: { id: '12', source: 'kugou', ref: 'kugou-12', title: '', artist: '', album: null },
    })
    expect(api.call).not.toHaveBeenCalled()
    host.intent({ type: 'seek', seconds: 70, resume: false })
    expect(api.call).not.toHaveBeenCalled()
    host.intent({
      type: 'enqueue',
      songs: [song('12')],
    })
    await vi.waitFor(() =>
      expect(api.call).toHaveBeenCalledWith('multiAdd', { roomId: 'official_room', songId: '12' }),
    )
    controller.dispose()
  })
  it('publishes occurrences and routes own delete/top actions without treating selection as a recommendation', async () => {
    const { controller, host, api } = setup()
    await controller.connect()
    await controller.enter('restore')
    await controller.refreshQueue()
    const entry = (biz: string, uid: string) => ({
      songId: '2',
      songBizId: biz,
      songRcmdUid: uid,
      track: {
        id: '2',
        name: 'Repeated song',
        artist: 'Artist',
        album: '',
        cover: '',
        duration: 30000,
      },
      recommender: '',
      selfRecommended: uid === '9',
      uped: false,
      upCount: 0,
      liked: false,
      likeCount: 0,
    })
    controller.patch({ queue: [entry('200', '9'), entry('201', '10')] })
    const queue = host.lease.setQueue.mock.lastCall![0]
    expect(queue.entries.map((entry: any) => entry.id)).toEqual(['101', '200', '201'])
    expect(queue.entries[0].actions.map((a: any) => a.id)).toEqual(['like'])
    expect(queue.entries[1].actions.map((a: any) => a.id)).toEqual(['promote', 'remove'])
    expect(queue.entries[2].actions.map((a: any) => a.id)).toEqual(['promote'])
    api.call.mockClear()
    host.intent({ type: 'queue-action', entryId: '201', actionId: 'remove' })
    host.intent({ type: 'queue-action', entryId: '101', actionId: 'promote' })
    expect(api.call).not.toHaveBeenCalled()
    host.intent({ type: 'queue-action', entryId: '200', actionId: 'remove' })
    await vi.waitFor(() =>
      expect(api.call).toHaveBeenCalledWith('multiRemove', {
        roomId: 'official_room',
        songId: '2',
        bizId: '200',
      }),
    )
    controller.dispose()
  })
  it('sends each rapid like, including while another UI operation is busy, without refetching the entire queue', async () => {
    const { controller, host, api } = setup()
    await controller.connect()
    await controller.enter('restore')
    await controller.refreshQueue()
    api.call.mockClear()
    controller.patch({ busy: true })
    for (let i = 0; i < 8; i++)
      host.intent({ type: 'queue-action', entryId: '101', actionId: 'like' })
    await vi.waitFor(() =>
      expect(api.call.mock.calls.filter(([method]) => method === 'multiLike')).toHaveLength(8),
    )
    expect(api.call.mock.calls.filter(([method]) => method === 'multiQueue')).toHaveLength(0)
    controller.dispose()
  })
  it('drops queued likes after leaving, and never retries an uncertain write', async () => {
    const { controller, api } = setup()
    await controller.connect()
    await controller.enter('restore')
    await controller.refreshQueue()
    api.call.mockClear()
    let finish!: () => void
    api.call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ code: 200, data: { success: true } })
        }),
    )
    const first = controller.likeCurrent(),
      second = controller.likeCurrent()
    await vi.waitFor(() => expect(api.call).toHaveBeenCalledTimes(1))
    controller.detach()
    finish()
    await Promise.all([first, second])
    expect(api.call).toHaveBeenCalledTimes(1)
    controller.dispose()
  })
  it('does not create a second room; reports server-side failure without pretending success', async () => {
    const { controller, host, api } = setup()
    host.state.song = {
      id: '1',
      source: 'netease',
      ref: '1',
      title: '歌曲',
      artist: '',
      album: null,
    }
    await controller.connect()
    await controller.run(() => controller.enter('create'))
    expect(controller.state.room).toBeNull()
    expect(controller.state.error).toContain('已经在多人房间')
    expect(controller.state.availableRoom?.roomId).toBe('official_room')
    expect(api.call.mock.calls.some(([method]) => method === 'multiCreate')).toBe(false)
    expect(host.bridge.acquire).not.toHaveBeenCalled()
    controller.dispose()
  })
  it('does not send a leave when merely disabling the plugin', async () => {
    const { controller, api } = setup()
    await controller.connect()
    await controller.enter('restore')
    controller.dispose()
    expect(api.call.mock.calls.some(([method]) => method === 'multiLeave')).toBe(false)
    expect(api.close).toHaveBeenCalled()
  })
  it('drops a late heartbeat after leaving', async () => {
    const { controller, api } = setup()
    await controller.connect()
    await controller.enter('restore')
    let reply!: (value: any) => void
    api.call.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve
        }),
    )
    const poll = controller.observe()
    await controller.leave()
    reply({ code: 200, data: { roomPlaySongInfo: rawSnapshot().roomPlaySongInfo } })
    await poll
    expect(controller.state.room).toBeNull()
    controller.dispose()
  })
})

it('discovers an existing room without taking over playback or showing a connection notice', async () => {
  const { controller, host } = setup()
  await controller.connect()
  expect(controller.state.availableRoom?.roomId).toBe('official_room')
  expect(controller.state.room).toBeNull()
  expect(controller.state.notice).toBe('')
  expect(host.lease.play).not.toHaveBeenCalled()
  controller.dispose()
})
it('starts and cancels matching without acquiring a room from a pending response', async () => {
  vi.useFakeTimers()
  const { controller, host, api } = setup()
  api.call.mockImplementation(
    async (method: string) =>
      ({ code: 200, data: { success: true, multiLtRoomSnapshot: null } }) as any,
  )
  await controller.connect()
  host.state.song = {
    id: '1',
    source: 'netease',
    ref: '1',
    title: 'Song',
    artist: '',
    album: null,
  }
  await controller.match()
  expect(controller.state.matching).toBe(true)
  expect(controller.state.room).toBeNull()
  expect(host.bridge.acquire).not.toHaveBeenCalled()
  await controller.cancelMatch()
  await vi.advanceTimersByTimeAsync(4000)
  expect(controller.state.matching).toBe(false)
  expect(api.call).toHaveBeenCalledWith('multiMatchCancel')
  controller.dispose()
})

it('adopts a confirmed matched room and stops the matching loop', async () => {
  vi.useFakeTimers()
  const { controller, host, api } = setup()
  let matched = false
  api.call.mockImplementation(async (method: string) => {
    if (method === 'multiStatus')
      return {
        code: 200,
        data: { status: 'RECONNECT_SUCCESS', multiLtRoomSnapshot: matched ? rawSnapshot() : null },
      } as any
    return {
      code: 200,
      data: { success: true, songLists: [], records: [], page: { more: false } },
    } as any
  })
  await controller.connect()
  host.state.song = { id: '1', source: 'netease', ref: '1', title: '', artist: '', album: null }
  await controller.match()
  matched = true
  await vi.advanceTimersByTimeAsync(2500)
  expect(controller.state.room?.roomId).toBe('official_room')
  expect(controller.state.matching).toBe(false)
  expect(api.call.mock.calls.some(([method]) => method === 'multiJoin')).toBe(false)
  controller.dispose()
})

it('does not activate a late match acknowledgement while cancellation is pending', async () => {
  vi.useFakeTimers()
  const { controller, host, api } = setup()
  let pendingMatch = false
  let finishAck!: (value: any) => void
  let finishCancel!: (value: any) => void
  api.call.mockImplementation(async (method: string) => {
    if (method === 'multiStatus')
      return {
        code: 200,
        data: { multiLtRoomSnapshot: pendingMatch ? rawSnapshot() : null },
      } as any
    if (method === 'multiJoin')
      return new Promise((resolve) => {
        finishAck = resolve
      }) as any
    if (method === 'multiMatchCancel') {
      pendingMatch = false
      return new Promise((resolve) => {
        finishCancel = resolve
      }) as any
    }
    return { code: 200, data: { success: true } } as any
  })
  await controller.connect()
  host.state.song = { id: '1', source: 'netease', ref: '1', title: '', artist: '', album: null }
  await controller.match()
  pendingMatch = true
  notifications.receive({ kind: 'ready', roomId: 'official_room' })
  await vi.advanceTimersByTimeAsync(1)
  expect(finishAck).toBeTypeOf('function')
  const cancel = controller.cancelMatch()
  finishAck({ code: 200, data: { success: true, multiLtRoomSnapshot: rawSnapshot() } })
  await vi.advanceTimersByTimeAsync(1)
  expect(controller.state.room).toBeNull()
  expect(host.lease.play).not.toHaveBeenCalled()
  finishCancel({ code: 200 })
  await cancel
  expect(controller.state.matching).toBe(false)
  controller.dispose()
})

it('times out matching even when status requests keep failing', async () => {
  vi.useFakeTimers()
  const { controller, host, api } = setup()
  let failStatus = false
  api.call.mockImplementation(async (method: string) => {
    if (method === 'multiStatus' && failStatus) throw new Error('网络中断')
    return { code: 200, data: { success: true, multiLtRoomSnapshot: null } } as any
  })
  await controller.connect()
  host.state.song = { id: '1', source: 'netease', ref: '1', title: '', artist: '', album: null }
  await controller.match()
  failStatus = true
  await vi.advanceTimersByTimeAsync(62000)
  expect(api.call).toHaveBeenCalledWith('multiMatchCancel')
  expect(controller.state.matching).toBe(false)
  expect(controller.state.error).toContain('匹配超时')
  controller.dispose()
})

it('leaves and rematches without stopping an already committed room song', async () => {
  const { controller, host, api } = setup()
  await controller.connect()
  await controller.enter('restore')
  await vi.waitFor(() => expect(host.state.state).toBe('playing'))
  const before = { ...host.state }
  api.call.mockImplementation(
    async () => ({ code: 200, data: { success: true, multiLtRoomSnapshot: null } }) as any,
  )
  await controller.match()
  expect(host.lease.handoff).toHaveBeenCalledTimes(1)
  expect(host.lease.release).not.toHaveBeenCalled()
  expect(host.state).toEqual(before)
  expect(controller.state.matching).toBe(true)
  await controller.cancelMatch()
  controller.dispose()
})

it('shows operation feedback through host toast without retaining a notice in the panel state', async () => {
  const { controller, host } = setup()
  controller.patch({ notice: '已为房间歌曲点赞' })
  expect(host.folium.ui.toast).toHaveBeenCalledWith(
    '已为房间歌曲点赞',
    expect.objectContaining({ type: 'success', durationMs: 2500 }),
  )
  expect(controller.state.notice).toBe('')
  controller.dispose()
})

it('changes the matching song without playing or recommending it, and rematches with the selected ID', async () => {
  const { controller, host, api } = setup()
  await controller.connect()
  await controller.enter('restore')
  await vi.waitFor(() => expect(host.state.state).toBe('playing'))
  const before = { ...host.state }
  host.lease.play.mockClear()
  api.call.mockClear()
  controller.selectMatchSong(song('22'))
  expect(controller.getMatchSong()?.id).toBe('22')
  expect(host.state).toEqual(before)
  expect(host.lease.play).not.toHaveBeenCalled()
  expect(api.call).not.toHaveBeenCalled()
  api.call.mockImplementation(async () => ({ code: 200, data: { success: true } }) as any)
  await controller.match()
  expect(api.call).toHaveBeenCalledWith('multiMatch', { songId: '22' })
  expect(host.state).toEqual(before)
  expect(api.call.mock.calls.some(([method]) => method === 'multiAdd')).toBe(false)
  expect(() => controller.selectMatchSong(song('23'))).toThrow('等待当前操作')
  controller.dispose()
})

it('captures the matching song before leaving, rejects changes during that request, and resets on account change', async () => {
  const { controller, host, api } = setup()
  await controller.connect()
  await controller.enter('restore')
  controller.selectMatchSong(song('22'))
  let finish!: () => void
  api.call.mockImplementation(async (method) => {
    if (method === 'multiLeave')
      await new Promise<void>((resolve) => {
        finish = resolve
      })
    return { code: 200, data: { success: true } } as any
  })
  const task = controller.match()
  expect(() => controller.selectMatchSong(song('23'))).toThrow('等待当前操作')
  host.state.song = song('24')
  finish()
  await task
  expect(api.call).toHaveBeenCalledWith('multiMatch', { songId: '22' })
  controller.patch({ account: null })
  expect(controller.state.matchSong).toBeNull()
  controller.dispose()
})

it('keeps creation tied to current playback while a different matching song is selected', async () => {
  const { controller, host, api } = setup()
  api.call.mockImplementation(
    async (method) =>
      ({
        code: 200,
        data: {
          success: true,
          multiLtRoomSnapshot: method === 'multiCreate' ? rawSnapshot() : null,
          songLists: [],
          records: [],
          page: { more: false },
        },
      }) as any,
  )
  await controller.connect()
  host.state.song = song('1')
  controller.selectMatchSong(song('22'))
  await controller.enter('create')
  expect(api.call).toHaveBeenCalledWith('multiCreate', { songId: '1', allowStrangerMatch: false })
  controller.dispose()
})

it('can restore the current-song default and rejects invalid selections before room mutation', async () => {
  const { controller, host, api } = setup()
  await controller.connect()
  host.state.song = song('1')
  controller.selectMatchSong(song('22'))
  controller.selectMatchSong(null)
  expect(controller.getMatchSong()?.id).toBe('1')
  expect(() => controller.selectMatchSong({ ...song('2'), source: 'qq' })).toThrow(
    '有效的网易云歌曲',
  )
  expect(() => controller.selectMatchSong(song('0'))).toThrow('有效的网易云歌曲')
  host.state.song = null
  api.call.mockClear()
  await expect(controller.match()).rejects.toThrow('请选择一首网易云歌曲')
  expect(api.call).not.toHaveBeenCalled()
  controller.dispose()
})

it('can match a searched song when nothing is playing without acquiring local playback', async () => {
  const { controller, host, api } = setup()
  api.call.mockImplementation(
    async () => ({ code: 200, data: { success: true, multiLtRoomSnapshot: null } }) as any,
  )
  await controller.connect()
  controller.selectMatchSong(song('22'))
  await controller.match()
  expect(api.call).toHaveBeenCalledWith('multiMatch', { songId: '22' })
  expect(host.state.song).toBeNull()
  expect(host.bridge.acquire).not.toHaveBeenCalled()
  controller.dispose()
})

it.each(['next', 'previous', 'ended'] as const)(
  'returns from audition on %s without mutating the room',
  async (type) => {
    const { controller, host, api } = setup()
    await controller.connect()
    await controller.enter('restore')
    await vi.waitFor(() => expect(host.state.song?.id).toBe('1'))
    host.intent({ type: 'audition', song: song('local-preview') })
    await vi.waitFor(() => expect(host.state.state).toBe('playing'))
    expect(controller.state.auditioning).toBe(true)
    expect(host.lease.setQueue.mock.lastCall![0]).toMatchObject({
      stopAction: { id: 'stop-audition', icon: 'square' },
      canSeek: true,
      canPrevious: true,
    })
    api.call.mockClear()
    host.intent({ type: 'seek', seconds: 50, resume: false })
    expect(host.lease.seek).toHaveBeenLastCalledWith(50)
    host.intent({ type })
    await vi.waitFor(() => expect(host.state.song?.id).toBe('1'))
    expect(controller.state.auditioning).toBe(false)
    expect(host.lease.setQueue.mock.lastCall![0].resumeActionId).toBeUndefined()
    expect(api.call.mock.calls.some(([method]) => ['multiNext', 'multiAdd'].includes(method))).toBe(
      false,
    )
    controller.dispose()
  },
)

it.each([false, true])(
  'stops an audition through the transport action and preserves prior room pause=%s',
  async (paused) => {
    const { controller, host, api } = setup()
    await controller.connect()
    await controller.enter('restore')
    await vi.waitFor(() => expect(host.state.state).toBe('playing'))
    if (paused) host.folium.playback.pause()
    host.intent({ type: 'audition', song: song('preview') })
    await vi.waitFor(() => expect(host.state.song?.id).toBe('preview'))
    const presentation = host.lease.setQueue.mock.lastCall![0]
    expect(presentation.actions?.map((action) => action.id)).toEqual(['sync'])
    expect(presentation.resumeActionId).toBeUndefined()
    expect(presentation.stopAction?.id).toBe('stop-audition')
    api.call.mockClear()
    host.intent({ type: 'queue-action', entryId: null, actionId: 'stop-audition' })
    await vi.waitFor(() => expect(host.state.song?.id).toBe('1'))
    expect(controller.state.auditioning).toBe(false)
    expect(host.state.state).toBe(paused ? 'paused' : 'playing')
    expect(host.lease.setQueue.mock.lastCall![0].stopAction).toBeUndefined()
    expect(
      api.call.mock.calls.some(([method]) =>
        ['multiLeave', 'multiNext', 'multiAdd'].includes(method),
      ),
    ).toBe(false)
    controller.dispose()
  },
)
