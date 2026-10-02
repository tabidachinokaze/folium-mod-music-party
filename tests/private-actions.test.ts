import { expect, it, vi } from 'vitest'
import { createPrivateResourceActions } from '../src/client/private-actions'
import type { PartyController } from '../src/client/controller'
import type { MessageAttachment } from '../vendor/music-party/src/shared/types'
import { fakeHost, song } from './fixtures'

// tests/private-actions.test.ts
const music = (type = 'song'): MessageAttachment => ({
  kind: 'resource',
  resourceType: type,
  resourceId: '701',
  title: '示例',
  actionUrl: `https://music.163.com/${type}?id=701`,
})
function setup() {
  const host = fakeHost(),
    report = vi.fn(),
    open = vi.fn(async () => {}),
    recommend = vi.fn(async () => {})
  const state = { account: { uid: '9' }, room: null as null | { roomId: string } }
  let view: string | null = 'peer'
  const controller = { folium: host.folium, state, recommend } as unknown as PartyController
  const actions = createPrivateResourceActions(controller, () => view, report, open)
  return {
    ...host,
    state,
    actions,
    recommend,
    report,
    open,
    leaveView: () => {
      view = null
    },
  }
}

it('resolves a shared song and plays through the host only on an explicit action', async () => {
  const host = setup()
  expect(host.actions.canActivate(music())).toBe(true)
  expect(host.folium.playback.playSong).not.toHaveBeenCalled()
  await host.actions.activate(music())
  expect(host.bridge.resolveSong).toHaveBeenCalledWith('netease', '701')
  expect(host.folium.playback.playSong).toHaveBeenCalledWith(song('701'))
  expect(host.recommend).not.toHaveBeenCalled()
})

it('recommends a clicked song to the room without replacing local playback', async () => {
  const host = setup()
  host.state.room = { roomId: 'room' }
  await host.actions.activate(music())
  expect(host.recommend).toHaveBeenCalledOnce()
  expect(host.recommend).toHaveBeenCalledWith('701')
  expect(host.folium.playback.playSong).not.toHaveBeenCalled()
  expect(host.bridge.resolveSong).not.toHaveBeenCalled()
})

it('opens an album in the native host and an activity through the external link handler', async () => {
  const host = setup()
  await host.actions.activate(music('album'))
  expect(host.folium.ui.openAlbum).toHaveBeenCalledWith('netease', '701')
  expect(host.open).not.toHaveBeenCalled()
  await host.actions.activate({
    kind: 'resource',
    title: '活动',
    actionUrl: 'https://music.163.com/g/activity?id=100',
  })
  expect(host.open).toHaveBeenCalledWith('https://music.163.com/g/activity?id=100')
  expect(host.folium.playback.playSong).not.toHaveBeenCalled()
})

it.each([
  'javascript:alert(1)',
  'file:///tmp/a',
  'orpheus://delete/1',
  'https://music.163.com.attacker.example/a',
])('does not turn an unsafe message target into an action: %s', async (actionUrl) => {
  const host = setup(),
    item = { ...music(), actionUrl }
  expect(host.actions.canActivate(item)).toBe(false)
  await host.actions.activate(item)
  expect(host.open).not.toHaveBeenCalled()
  expect(host.bridge.resolveSong).not.toHaveBeenCalled()
})

it.each(['view', 'room', 'account'] as const)(
  'cancels a pending song lookup after changing %s',
  async (change) => {
    const host = setup()
    let resolve!: (value: ReturnType<typeof song>) => void
    host.bridge.resolveSong.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const pending = host.actions.activate(music())
    if (change === 'view') host.leaveView()
    if (change === 'room') host.state.room = { roomId: 'next-room' }
    if (change === 'account') host.state.account = { uid: '11' }
    resolve(song('701'))
    await pending
    expect(host.folium.playback.playSong).not.toHaveBeenCalled()
    expect(host.recommend).not.toHaveBeenCalled()
  },
)

it('shows an actionable error when album navigation is unavailable', async () => {
  const host = setup()
  host.folium.ui.openAlbum = undefined
  await host.actions.activate(music('album'))
  expect(host.report).toHaveBeenCalledWith(expect.stringContaining('Folia'), true)
  expect(host.open).not.toHaveBeenCalled()
})
