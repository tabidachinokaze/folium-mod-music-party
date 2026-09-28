import { afterEach, describe, expect, it, vi } from 'vitest'
import { PartyController } from '../src/client/controller'
import type { AccountConnection } from '../src/client/host'
import { fakeHost, rawSnapshot } from './fixtures'

// tests/controller.test.ts
afterEach(() => vi.useRealTimers())
function setup() {
  const host = fakeHost()
  const api = {
    connect: vi.fn(async () => ({ uid: '9', nickname: '测试账号' })),
    close: vi.fn(),
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
  it('recommends only explicit Netease selections, and ignores playback seeks', async () => {
    const { controller, host, api } = setup()
    await controller.connect()
    await controller.enter('restore')
    api.call.mockClear()
    host.intent({
      type: 'play',
      song: { id: '12', source: 'kugou', ref: null, title: '', artist: '', album: null },
    })
    expect(api.call).not.toHaveBeenCalled()
    host.intent({ type: 'seek', seconds: 70, resume: false })
    expect(api.call).not.toHaveBeenCalled()
    host.intent({
      type: 'play',
      song: { id: '12', source: 'netease', ref: 'song-12', title: '', artist: '', album: null },
    })
    await vi.waitFor(() =>
      expect(api.call).toHaveBeenCalledWith('multiAdd', { roomId: 'official_room', songId: '12' }),
    )
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
    expect(api.call.mock.calls.some(([method]) => method === 'multiCreate')).toBe(false)
    expect(host.lease.release).toHaveBeenCalled()
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
