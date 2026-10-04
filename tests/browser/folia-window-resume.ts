import { expect, type APIRequestContext, type Page } from '@playwright/test'

// tests/browser/folia-window-resume.ts
// Exercise the real host continuation API without reloading the mock account bootstrap.
export async function verifyNativeWindowResume(page: Page, request: APIRequestContext) {
  const playback = () => page.evaluate(() => (window as any).partyHost.api.playback.getState())
  await expect.poll(async () => (await playback()).state).toBe('paused')
  const before = await (await request.get('/test/state')).json()
  const saved = await page.evaluate(async () => {
    const { capturePlaybackWindowResume } = await import(
      /* @vite-ignore */ '/src/services/externalPlaybackWindowResume.ts' as string
    )
    const { api, dispose } = (window as any).partyHost
    const state = api.playback.getState()
    const ticket = capturePlaybackWindowResume()
    if (!ticket || !state.song) throw new Error('The active room must provide a window ticket')
    ;(window as any).partyWindowResumeProbe = {
      ticket: structuredClone(ticket),
      song: state.song,
      position: state.position,
      queue: structuredClone(ticket.queue),
    }
    dispose()
    return { songId: state.song.id, room: ticket.state }
  })
  expect(saved.room).toMatchObject({ listening: false })
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { hasExternalPlayback } = await import(
          /* @vite-ignore */ '/src/services/externalPlaybackSession.ts' as string
        )
        return hasExternalPlayback()
      }),
    )
    .toBe(false)

  // Rebuild ordinary playback first, as the window handoff does before delivering
  // its ticket. Use the public play/seek controls; only queue restoration uses
  // the host setter because Folium intentionally has no queue replacement API.
  expect(
    await page.evaluate(() => {
      const { api } = (window as any).partyHost
      return api.playback.playSong((window as any).partyWindowResumeProbe.song)
    }),
  ).toBe(true)
  await expect.poll(async () => (await playback()).song?.id).toBe(saved.songId)
  await expect.poll(async () => (await playback()).state).toBe('playing')
  await page.evaluate(async () => {
    const { setPlayQueue } = await import(
      /* @vite-ignore */ '/src/stores/usePlaybackStore.ts' as string
    )
    const { api } = (window as any).partyHost
    const snapshot = (window as any).partyWindowResumeProbe
    api.playback.seek(snapshot.position)
    api.playback.pause()
    setPlayQueue(snapshot.queue)
  })
  await expect.poll(async () => (await playback()).state).toBe('paused')
  await page.evaluate(async () => {
    const load = (url: string) => import(/* @vite-ignore */ url)
    const [{ restorePlaybackWindowResume }, { default: activate }] = await Promise.all([
      load('/src/services/externalPlaybackWindowResume.ts'),
      load('http://127.0.0.1:4176/client.mjs'),
    ])
    restorePlaybackWindowResume((window as any).partyWindowResumeProbe.ticket)
    const host = (window as any).partyHost
    host.dispose = activate(host.api)
  })
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { capturePlaybackWindowResume } = await import(
          /* @vite-ignore */ '/src/services/externalPlaybackWindowResume.ts' as string
        )
        return capturePlaybackWindowResume()?.state ?? null
      }),
    )
    .toEqual(saved.room)
  await expect.poll(async () => (await playback()).song?.id).toBe(saved.songId)
  await expect.poll(async () => (await playback()).duration).toBeGreaterThan(0)
  await expect.poll(async () => (await playback()).state).toBe('paused')
  await page.evaluate(() => (window as any).partyHost.api.ui.openQueue())
  await expect(
    page
      .getByTestId('unified-panel-surface')
      .getByRole('button', { name: '同步队列', exact: true }),
  ).toBeEnabled()
  await page.evaluate(() => (window as any).partyHost.api.ui.openPlayerPanel('room'))
  await expect(page.getByRole('button', { name: '退出房间', exact: true })).toBeVisible()
  const queueRestored = await page.evaluate(async () => {
    const { capturePlaybackWindowResume } = await import(
      /* @vite-ignore */ '/src/services/externalPlaybackWindowResume.ts' as string
    )
    const { getPlaybackSongKey } = await import(
      /* @vite-ignore */ '/src/utils/appPlaybackGuards.ts' as string
    )
    return {
      expected: (window as any).partyWindowResumeProbe.queue.map(getPlaybackSongKey),
      actual: capturePlaybackWindowResume()?.queue.map(getPlaybackSongKey),
    }
  })
  expect(queueRestored.actual).toEqual(queueRestored.expected)
  const after = await (await request.get('/test/state')).json()
  const mutations = (calls: string[]) =>
    calls.filter((uri) => /\/(?:room\/create|match\/ack|match\/exit|multi\/match)$/.test(uri))
  expect(mutations(after.calls)).toEqual(mutations(before.calls))
  expect(after.operations).toEqual(before.operations)
  expect(after.joined).toBe(true)
  await page.evaluate(() => delete (window as any).partyWindowResumeProbe)
}
