import { test, expect } from '@playwright/test'
import { verifyAlbumAuditionAndRemote, verifyPrivateSongChoices } from './folia-resources'

// tests/browser/folia.spec.ts
// Optional integration against the real patched Folia dev renderer and audio pipeline.
const foliaUrl = process.env.FOLIA_URL
test.skip(!foliaUrl, 'Set FOLIA_URL to the patched Folia Vite server')
test('actual Folium registration and host audio: restore, native next, local pause and release', async ({
  page,
  request,
}) => {
  test.setTimeout(120000)
  page.setDefaultTimeout(15000)
  await request.get('/test/reset')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('i18nextLng', 'zh-CN')
    localStorage.setItem('folia_last_seen_ponder_onboarding_version', '0.7.18')
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
      getPlaybackSyncBridgeStatus: async () => ({
        remoteControlOpen: true,
        discordPresenceEnabled: false,
      }),
      publishRemoteControlSnapshot: async (snapshot: unknown) => {
        ;(window as any).partyRemoteSnapshot = snapshot
      },
      reportDevicePixelRatio: () => {},
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
        folia: '>=0.7.13 <=0.7.18',
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
  })
  // The splash can disappear before React's host-action effect has registered the UI services.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          try {
            return Boolean((window as any).partyHost.api.playback.getState())
          } catch {
            return false
          }
        }),
      { timeout: 30000 },
    )
    .toBe(true)
  await page.evaluate(() => {
    const { api } = (window as any).partyHost
    api.ui.navigate('player')
    api.ui.openPlayerPanel('room')
  })
  await page.getByRole('button', { name: '一起听', exact: true }).click()
  await expect(
    page
      .getByRole('button', { name: '一起听', exact: true })
      .locator('svg[data-folium-custom-icon]'),
  ).toBeVisible()
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await expect(page.locator('.mp-panel > .mp-header .mp-pill')).toHaveText('3 人一起听')
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
  // Real host locale changes remount the surface without releasing room playback.
  await page.evaluate(async () => {
    const { default: i18n } = await import(/* @vite-ignore */ '/src/i18n/config.ts' as string)
    await i18n.changeLanguage('en')
  })
  await expect(page.getByRole('tab', { name: 'Members', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Change song', exact: true })).toBeVisible()
  await expect(page.locator('.mp-panel > .mp-header .mp-pill')).toHaveText('3 listening together')
  expect(await page.evaluate(() => (window as any).partyHost.api.playback.getState().state)).toBe(
    'playing',
  )
  await page.screenshot({ path: 'test-results/folia-english.png', animations: 'disabled' })
  await page.evaluate(async () => {
    const { default: i18n } = await import(/* @vite-ignore */ '/src/i18n/config.ts' as string)
    await i18n.changeLanguage('zh-CN')
  })
  await expect(page.getByRole('tab', { name: '成员', exact: true })).toBeVisible()
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
  await page.getByRole('button', { name: '切换歌曲', exact: true }).click()
  const matchPicker = page.getByRole('dialog', { name: '选择匹配歌曲' })
  await matchPicker.getByRole('searchbox', { name: '搜索网易云歌曲' }).fill('下一站')
  await matchPicker.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(
    matchPicker.getByRole('button', { name: '选择 下一站 · 20 · 岛屿来信', exact: true }),
  ).toBeVisible()
  await expect
    .poll(async () => {
      const panel = (await page.getByTestId('unified-panel-surface').boundingBox())!
      const popup = (await matchPicker.boundingBox())!
      return popup.x + popup.width <= panel.x - 8
    })
    .toBe(true)
  await page.screenshot({ path: 'test-results/folia-side-popup.png', animations: 'disabled' })
  await matchPicker
    .getByRole('button', { name: '选择 下一站 · 20 · 岛屿来信', exact: true })
    .click()
  await expect(page.locator('.mp-match-song-summary')).toContainText('下一站 · 20')
  expect((await (await request.get('/test/state')).json()).operations).toHaveLength(0)
  expect(
    await page.evaluate(() => (window as any).partyHost.api.playback.getState().song?.id),
  ).toBe('1')
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
  await page.evaluate(() => (window as any).partyHost.api.ui.openQueue())
  await expect(page.getByRole('button', { name: '同步队列', exact: true })).toBeVisible()
  await expect(page.getByRole('tab', { name: '待播', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '打乱队列', exact: true })).toHaveCount(0)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useExternalQueueStore } = await import(
          /* @vite-ignore */ '/src/services/externalPlaybackQueue.ts' as string
        )
        return useExternalQueueStore.getState().view?.queue.length
      }),
    )
    .toBe(10)
  const repeated = await page.evaluate(async () => {
    const { useExternalQueueStore } = await import(
      /* @vite-ignore */ '/src/services/externalPlaybackQueue.ts' as string
    )
    return useExternalQueueStore
      .getState()
      .view.queue.filter((song: any) => song.id === '2')
      .map((song: any) => song.externalQueueEntryKey)
  })
  expect(new Set(repeated).size).toBe(2)
  const like = page.getByRole('button', { name: '为这首歌点赞', exact: true })
  await like.locator('xpath=../../..').hover()
  for (let i = 0; i < 5; i++) await like.click()
  await expect.poll(async () => (await (await request.get('/test/state')).json()).likes).toBe(5)
  const remove = page.getByRole('button', { name: '删除我的推荐', exact: true }).first()
  await remove.locator('xpath=../../..').hover()
  await remove.click()
  await expect
    .poll(async () =>
      (await (await request.get('/test/state')).json()).operations
        .filter((op: any) => op.operate === 7)
        .map((op: any) => op.bizId),
    )
    .toEqual(['200'])
  const promote = page.getByRole('button', { name: '置顶', exact: true }).nth(1)
  await promote.locator('xpath=../../..').hover()
  await promote.click()
  await expect
    .poll(async () =>
      (await (await request.get('/test/state')).json()).operations
        .filter((op: any) => op.operate === 2)
        .map((op: any) => op.bizId),
    )
    .toEqual(['202'])
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useExternalQueueStore } = await import(
          /* @vite-ignore */ '/src/services/externalPlaybackQueue.ts' as string
        )
        return useExternalQueueStore
          .getState()
          .view.queue[1].externalQueueEntryKey.split(':')
          .at(-1)
      }),
    )
    .toBe('202')
  await page.screenshot({ path: 'test-results/folia-native-queue.png', fullPage: true })
  await page.locator('[data-ponder=player-bar]').hover()
  await page.getByRole('button', { name: '下一首', exact: true }).first().click()
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().song?.id), {
      timeout: 20000,
    })
    .toBe('2')
  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(async () => (await (await request.get('/test/state')).json()).current).toBe('3')
  await expect(page.getByRole('button', { name: '同步队列', exact: true })).toBeEnabled()
  await page.evaluate(async () => {
    const { openCommandPaletteCommand } = await import(
      /* @vite-ignore */ '/src/stores/useAppViewStore.ts' as string
    )
    openCommandPaletteCommand('playback-next')
  })
  await page.getByRole('combobox').press('Enter')
  await expect.poll(async () => (await (await request.get('/test/state')).json()).current).toBe('4')
  await page.keyboard.press('Escape')
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().song?.id))
    .toBe('4')
  await page.evaluate(() => (window as any).partyHost.api.playback.pause())
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().state))
    .toBe('paused')
  await page.evaluate(() => (window as any).partyHost.api.ui.openQueue())
  await page.getByRole('button', { name: '同步队列', exact: true }).click()
  expect(await page.evaluate(() => (window as any).partyHost.api.playback.getState().state)).toBe(
    'paused',
  )
  await page.evaluate(async () => {
    const { openCommandPaletteCommand } = await import(
      /* @vite-ignore */ '/src/stores/useAppViewStore.ts' as string
    )
    openCommandPaletteCommand('queue')
  })
  const palette = page.getByTestId('command-palette-queue-view')
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('button', { name: '同步队列', exact: true })).toBeVisible()
  await expect(palette.getByRole('button', { name: '下一首播放', exact: true })).toHaveCount(0)
  await expect(palette.getByRole('button', { name: '移到队尾', exact: true })).toHaveCount(0)
  await page.getByRole('combobox').fill('待播歌曲 9')
  await expect(palette.getByText('待播歌曲 9', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window as any).partyHost.api.ui.navigate('home'))
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  await expect(page.getByText('一起听这首吧', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '小岛', exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: '私信内容' }).pressSequentially(':n')
  await page.getByRole('textbox', { name: '私信内容' }).press('Control+ArrowRight')
  expect((await (await request.get('/test/state')).json()).current).toBe('4')
  expect(
    await page
      .locator('[data-home-mod-tab]')
      .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
  ).toBe(true)
  expect(
    await page
      .locator('.mp-private-home')
      .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
  ).toBe(true)
  await page.screenshot({ path: 'test-results/folia-private-home.png', fullPage: true })
  // A share opens the same native album view as the host library, with private messages behind it.
  await request.post('/test/private-resources')
  await page.getByRole('button', { name: '刷新私信', exact: true }).click()
  const sharedAlbum = page.getByRole('button', { name: '查看专辑 海边专辑', exact: true })
  await expect(sharedAlbum).toBeVisible()
  const playbackBeforeAlbum = await page.evaluate(() => {
    const state = (window as any).partyHost.api.playback.getState()
    return { id: state.song?.id, source: state.song?.source, state: state.state }
  })
  await sharedAlbum.click()
  const albumView = page.locator('[data-ponder-page-scope="grid-view-page"]')
  await expect(
    // The native title includes its accessible expand/collapse indicator.
    albumView.getByRole('heading', { level: 2, name: /^海边专辑(?:\s|$)/ }),
  ).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { useCollectionNavigationStore } = await import(
          /* @vite-ignore */ '/src/stores/useCollectionNavigationStore.ts' as string
        )
        return String(useCollectionNavigationStore.getState().snapshot?.stack.at(-1)?.id ?? '')
      }),
    )
    .toBe('700')
  expect(
    await page.evaluate(() => {
      const state = (window as any).partyHost.api.playback.getState()
      return { id: state.song?.id, source: state.song?.source, state: state.state }
    }),
  ).toEqual(playbackBeforeAlbum)
  await page.screenshot({ path: 'test-results/folia-private-album.png', animations: 'disabled' })
  await verifyAlbumAuditionAndRemote(page, request, foliaUrl!)
  await albumView.locator('button:has(svg.lucide-chevron-left)').first().click()
  await expect(albumView).toHaveCount(0)
  await expect(sharedAlbum).toBeVisible()
  await verifyPrivateSongChoices(page, request)
  await page.getByTestId('home-lattice-pill').click()
  await expect(page.locator('.lattice-root')).toBeVisible()
  await expect(
    page.locator('.lattice-poster').filter({ hasText: '待播歌曲 9' }).first(),
  ).toBeVisible()
  // The infinite collage repeats tiles spatially; keyboard focus selects one occurrence.
  const currentPoster = page.locator('.lattice-poster.is-current').first()
  await currentPoster.focus()
  await currentPoster.press('Enter')
  await expect(
    page
      .locator('.lattice-poster.is-expanded')
      .getByRole('button', { name: '为这首歌点赞', exact: true }),
  ).toBeVisible()
  await page
    .locator('.lattice-poster.is-expanded')
    .getByRole('button', { name: '为这首歌点赞', exact: true })
    .click()
  await expect.poll(async () => (await (await request.get('/test/state')).json()).likes).toBe(7)
  await page.screenshot({ path: 'test-results/folia-lattice.png', fullPage: true })
  await page.evaluate(() => {
    ;(window as any).partyHost.api.ui.navigate('player')
    ;(window as any).partyHost.api.ui.openPlayerPanel('room')
  })
  const beforeLeave = await page.evaluate(() => {
    const audio = Array.from(document.querySelectorAll('audio')).find(
      (item) => item.currentSrc && item.duration > 0,
    )!
    ;(window as any).partyContinuityAudio = audio
    return {
      song: (window as any).partyHost.api.playback.getState().song?.id,
      src: audio.currentSrc,
      time: audio.currentTime,
    }
  })
  await page.getByRole('button', { name: '退出房间', exact: true }).click()
  await expect(page.getByRole('heading', { name: '房间信息', exact: true })).toBeHidden()
  const afterLeave = await page.evaluate(() => {
    const audio = (window as any).partyContinuityAudio as HTMLAudioElement
    return {
      song: (window as any).partyHost.api.playback.getState().song?.id,
      src: audio.currentSrc,
      time: audio.currentTime,
      state: (window as any).partyHost.api.playback.getState().state,
    }
  })
  expect(afterLeave.song).toBe(beforeLeave.song)
  expect(afterLeave.src).toBe(beforeLeave.src)
  expect(afterLeave.time).toBeCloseTo(beforeLeave.time, 0)
  expect(afterLeave.state).toBe('paused')
  expect(await page.locator('audio[loop]').count()).toBeGreaterThan(0)
  await page.evaluate(() => (window as any).partyHost.dispose())
  expect(errors).toEqual([])
})
