import { expect, it, vi } from 'vitest'
import { createPrivateResourceActions } from '../src/client/private-actions'
import type { PartyController } from '../src/client/controller'
import type { MessageAttachment } from '../vendor/music-party/src/shared/types'
import { fakeHost, song } from './fixtures'
import type { PrivateSongChoice } from '../src/client/private-song-choice'

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
    recommend = vi.fn(async () => {}),
    audition = vi.fn(async () => true),
    choose = vi.fn(
      async (_item: MessageAttachment, _signal: AbortSignal): Promise<PrivateSongChoice | null> =>
        'recommend',
    )
  Object.assign(host.folium.playback, { auditionSong: audition })
  const state = { account: { uid: '9' }, room: null as null | { roomId: string } }
  let view: string | null = 'peer'
  const controller = { folium: host.folium, state, recommend } as unknown as PartyController
  const actions = createPrivateResourceActions(controller, () => view, report, open, choose)
  return {
    ...host,
    state,
    actions,
    recommend,
    audition,
    choose,
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
  expect(host.choose).not.toHaveBeenCalled()
  expect(host.audition).not.toHaveBeenCalled()
})

it('recommends a clicked song only after the room choice explicitly selects recommend', async () => {
  const host = setup()
  host.state.room = { roomId: 'room' }
  await host.actions.activate(music())
  expect(host.choose).toHaveBeenCalledWith(music(), expect.any(AbortSignal))
  expect(host.recommend).toHaveBeenCalledOnce()
  expect(host.recommend).toHaveBeenCalledWith('701')
  expect(host.folium.playback.playSong).not.toHaveBeenCalled()
  expect(host.bridge.resolveSong).not.toHaveBeenCalled()
  expect(host.audition).not.toHaveBeenCalled()
})

it('auditions a room card through the dedicated host API without recommending or ordinary playSong', async () => {
  const host = setup()
  host.state.room = { roomId: 'room' }
  host.choose.mockResolvedValueOnce('audition')
  await host.actions.activate(music())
  expect(host.bridge.resolveSong).toHaveBeenCalledWith('netease', '701')
  expect(host.audition).toHaveBeenCalledWith(song('701'))
  expect(host.recommend).not.toHaveBeenCalled()
  expect(host.folium.playback.playSong).not.toHaveBeenCalled()
})

it('does nothing when the song choice is dismissed', async () => {
  const host = setup()
  host.state.room = { roomId: 'room' }
  host.choose.mockResolvedValueOnce(null)
  await host.actions.activate(music())
  expect(host.recommend).not.toHaveBeenCalled()
  expect(host.bridge.resolveSong).not.toHaveBeenCalled()
  expect(host.audition).not.toHaveBeenCalled()
})

it.each(['view', 'room', 'account', 'cancel'] as const)(
  'does not recommend after a pending choice becomes stale through %s',
  async (change) => {
    const host = setup()
    host.state.room = { roomId: 'room' }
    let resolve!: (choice: PrivateSongChoice) => void
    host.choose.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const pending = host.actions.activate(music())
    if (change === 'view') host.leaveView()
    if (change === 'room') host.state.room = { roomId: 'other' }
    if (change === 'account') host.state.account = { uid: '11' }
    if (change === 'cancel') host.actions.cancel()
    resolve('recommend')
    await pending
    expect(host.recommend).not.toHaveBeenCalled()
    expect(host.audition).not.toHaveBeenCalled()
    expect(host.folium.playback.playSong).not.toHaveBeenCalled()
  },
)

it('aborts and dismisses the previous pending choice when another card is activated', async () => {
  const host = setup()
  host.state.room = { roomId: 'room' }
  let aborted = false
  host.choose.mockImplementationOnce(
    (_item, signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true
          resolve(null)
        })
      }),
  )
  const first = host.actions.activate(music())
  await host.actions.activate(music())
  await first
  expect(aborted).toBe(true)
  expect(host.recommend).toHaveBeenCalledOnce()
})

it.each(['view', 'room', 'account', 'cancel'] as const)(
  'does not start stale audition after lookup and a change to %s',
  async (change) => {
    const host = setup()
    host.state.room = { roomId: 'room' }
    host.choose.mockResolvedValueOnce('audition')
    let resolve!: (value: ReturnType<typeof song>) => void
    host.bridge.resolveSong.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const pending = host.actions.activate(music())
    await Promise.resolve()
    if (change === 'view') host.leaveView()
    if (change === 'room') host.state.room = { roomId: 'other' }
    if (change === 'account') host.state.account = { uid: '11' }
    if (change === 'cancel') host.actions.cancel()
    resolve(song('701'))
    await pending
    expect(host.audition).not.toHaveBeenCalled()
    expect(host.recommend).not.toHaveBeenCalled()
  },
)

it('asks to update the host instead of falling back to recommendation when audition is unavailable', async () => {
  const host = setup()
  host.state.room = { roomId: 'room' }
  host.choose.mockResolvedValueOnce('audition')
  delete (host.folium.playback as { auditionSong?: unknown }).auditionSong
  await host.actions.activate(music())
  expect(host.report).toHaveBeenCalledWith(expect.stringContaining('Folia'), true)
  expect(host.recommend).not.toHaveBeenCalled()
  expect(host.folium.playback.playSong).not.toHaveBeenCalled()
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
