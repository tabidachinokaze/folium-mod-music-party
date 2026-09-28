import { test, expect } from '@playwright/test'

// tests/browser/folia.spec.ts
// Optional integration against the real patched Folia dev renderer and audio pipeline.
const foliaUrl = process.env.FOLIA_URL
test.skip(!foliaUrl, 'Set FOLIA_URL to the patched Folia Vite server')
test('actual Folium registration and host audio: restore, native next, local pause and release', async ({
  page,
  request,
}) => {
  test.setTimeout(120000)
  await request.get('/test/reset')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('i18nextLng', 'zh-CN')
    localStorage.setItem('folia_last_seen_ponder_onboarding_version', '0.7.9')
    localStorage.setItem('online_provider:netease:cookie', 'MUSIC_U=test-only')
    localStorage.setItem('static_mode', 'true')
    localStorage.setItem('player_loop_mode', 'one')
    ;(window as any).electron = {
      getNeteasePort: async () => 4176,
      getNeteaseApiStatus: async () => ({ status: 'ready' }),
      getAudioCacheUsage: async () => 0,
      clearAudioCache: async () => {},
      getAudioCacheStats: async () => ({ size: 0, count: 0 }),
      isWindowMaximized: async () => false,
      onRemoteControlCommand: (callback: any) => {
        ;(window as any).partyRemote = callback
        return () => {}
      },
      onStagePlayerControlRequest: (callback: any) => {
        ;(window as any).partyStageControl = callback
        return () => {}
      },
      completeStagePlayerControlRequest: async (result: any) => {
        ;(window as any).partyStageReply = result
      },
      mods: {
        listMods: async () => ({ mods: [] }),
        onModsStateChanged: () => () => {},
        pushRuntimeSnapshot: async () => {},
        async invokeModRpc(_id: string, name: string, args: unknown[]) {
          return fetch('http://127.0.0.1:4176/rpc', {
            method: 'POST',
            body: JSON.stringify({ name, args }),
          }).then((r) => r.json())
        },
      },
    }
  })
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' && url.protocol === 'https:') {
      url.protocol = 'http:'
      return route.fetch({ url: url.toString() }).then((response) => route.fulfill({ response }))
    }
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.protocol === 'blob:' ||
      url.protocol === 'data:'
      ? route.continue()
      : route.fulfill({ contentType: 'application/json', body: '{}' })
  })
  await page.goto(foliaUrl!)
  await page.locator('#app-splash').waitFor({ state: 'detached', timeout: 60000 })
  await page.evaluate(async () => {
    const load = (url: string) => import(/* @vite-ignore */ url)
    const [
      { createFoliumClientApi },
      { createFoliumInternals },
      { installFoliumHostEvents },
      { createFoliumExperimental },
      { default: activate },
    ] = await Promise.all([
      load('/src/mods/folium/api.ts'),
      load('/src/mods/folium/internals.ts'),
      load('/src/mods/folium/hostEvents.ts'),
      load('/src/mods/folium/experimental.ts'),
      load('http://127.0.0.1:4176/client.mjs'),
    ])
    installFoliumHostEvents()
    const api = createFoliumClientApi(
      {
        id: 'music-party',
        name: 'Music Party',
        permissions: ['playback.control'],
        folia: '=0.7.9',
        experimental: ['playback.sessions'],
      },
      {
        context: 'main',
        internals: createFoliumInternals(),
        experimental: createFoliumExperimental({
          id: 'music-party',
          permissions: ['playback.control'],
          experimental: ['playback.sessions'],
        }),
      },
    )
    ;(window as any).partyHost = { api, dispose: activate(api) }
    api.ui.navigate('player')
    api.ui.openPlayerPanel('room')
  })
  await page.getByRole('button', { name: '连接网易云账号', exact: true }).click({ timeout: 15000 })
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await expect(page.getByText('3 人一起听', { exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().state), {
      timeout: 30000,
    })
    .toBe('playing')
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().song?.id))
    .toBe('1')
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().position))
    .toBeGreaterThan(4)
  expect(await page.locator('audio[loop]').count()).toBe(0)
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as any).partyHost.api.internals.stores.playback.getState().lyrics?.lines
              ?.length || 0,
        ),
      { timeout: 20000 },
    )
    .toBeGreaterThan(0)
  await page.evaluate(() => (window as any).partyRemote({ type: 'seek', time: 25 }))
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().position))
    .toBeLessThan(15)
  await page.evaluate(() =>
    (window as any).partyStageControl({
      requestId: 'seek-test',
      action: 'seek',
      positionMs: 25000,
    }),
  )
  await expect.poll(() => page.evaluate(() => (window as any).partyStageReply?.ok)).toBe(true)
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().position))
    .toBeLessThan(15)
  await page.screenshot({ path: 'test-results/folia-room.png', fullPage: true })
  await page.evaluate(() => (window as any).partyHost.api.playback.next())
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().song?.id), {
      timeout: 20000,
    })
    .toBe('2')
  await page.evaluate(() => (window as any).partyHost.api.playback.pause())
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().state))
    .toBe('paused')
  await page.getByRole('button', { name: '重新同步', exact: true }).click()
  expect(await page.evaluate(() => (window as any).partyHost.api.playback.getState().state)).toBe(
    'paused',
  )
  await page.getByRole('button', { name: '退出房间', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().song))
    .toBeNull()
  expect(await page.locator('audio[loop]').count()).toBeGreaterThan(0)
  await page.evaluate(() => (window as any).partyHost.dispose())
  expect(errors).toEqual([])
})
