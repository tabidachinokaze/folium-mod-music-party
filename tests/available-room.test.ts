import { afterEach, describe, expect, it, vi } from 'vitest'
import { PartyController } from '../src/client/controller'
import type { AccountConnection } from '../src/client/host'
import { fakeHost, rawSnapshot, song } from './fixtures'

// tests/available-room.test.ts
const controllers: PartyController[] = []
afterEach(() => controllers.splice(0).forEach((controller) => controller.dispose()))

async function setup() {
  const host = fakeHost()
  Object.assign(host.state, { song: song('99'), state: 'playing', position: 35, duration: 180 })
  const api = {
    connect: vi.fn(async () => ({ uid: '9', nickname: 'Listener' })),
    close: vi.fn(),
    call: vi.fn(async (method: string, _params?: unknown): Promise<any> =>
      method === 'multiStatus'
        ? { code: 200, data: { multiLtRoomSnapshot: rawSnapshot() } }
        : { code: 200, data: { success: true } },
    ),
  }
  const controller = new PartyController(host.folium, api as unknown as AccountConnection)
  controllers.push(controller)
  await controller.connect()
  api.call.mockClear()
  return { controller, host, api }
}

describe('leaving an available room without restoring local control', () => {
  it('leaves the detected room while normal music continues unchanged', async () => {
    const { controller, host, api } = await setup()
    const before = { ...host.state }
    await controller.run(() => controller.leaveAvailableRoom())
    expect(api.call).toHaveBeenCalledExactlyOnceWith('multiLeave', { roomId: 'official_room' })
    expect(controller.state.availableRoom).toBeNull()
    expect(controller.state.room).toBeNull()
    expect(host.state).toEqual(before)
    expect(host.bridge.acquire).not.toHaveBeenCalled()
    expect(host.lease.play).not.toHaveBeenCalled()
    expect(host.lease.stop).not.toHaveBeenCalled()
    expect(host.lease.release).not.toHaveBeenCalled()
    expect(host.lease.handoff).not.toHaveBeenCalled()
    expect(host.folium.playback.pause).not.toHaveBeenCalled()
    expect(host.folium.playback.play).not.toHaveBeenCalled()
    expect(host.folium.ui.toast).toHaveBeenCalledWith(
      '已退出房间，当前音乐继续播放。',
      expect.anything(),
    )
  })

  it('retains the available-room card and reports a rejected leave through the host toast', async () => {
    const { controller, host, api } = await setup()
    const available = controller.state.availableRoom
    api.call.mockRejectedValueOnce(new Error('Leave failed'))
    await controller.run(() => controller.leaveAvailableRoom())
    expect(controller.state.availableRoom).toBe(available)
    expect(controller.state.error).toBe('Leave failed')
    expect(host.folium.ui.toast).toHaveBeenCalledWith('Leave failed', expect.anything())
    expect(host.state.state).toBe('playing')
    expect(host.bridge.acquire).not.toHaveBeenCalled()
  })

  it.each(['room', 'account', 'detach'] as const)(
    'does not clear a newer available-room state after %s changes while leaving',
    async (change) => {
      const { controller, api } = await setup()
      const available = controller.state.availableRoom!
      let finish!: (value: any) => void
      api.call.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const pending = controller.leaveAvailableRoom()
      if (change === 'detach') controller.detach()
      if (change === 'account')
        controller.patch({ account: { uid: '10', nickname: 'New account' } })
      const replacement = {
        ...available,
        roomId: change === 'room' ? 'new_room' : available.roomId,
      }
      controller.patch({ availableRoom: replacement })
      finish({ code: 200, data: { success: true } })
      await pending
      expect(controller.state.availableRoom).toBe(replacement)
    },
  )

  it('ignores the unavailable-room action once this client owns a room', async () => {
    const { controller, api } = await setup()
    controller.patch({ room: controller.state.availableRoom })
    await controller.leaveAvailableRoom()
    expect(api.call).not.toHaveBeenCalled()
  })
})
