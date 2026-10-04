import { expect, type Page, type APIRequestContext } from '@playwright/test'
import { verifyRemoteRecording } from './folia-recording'

// tests/browser/folia-resources.ts
export async function verifyAlbumAuditionAndRemote(
  page: Page,
  request: APIRequestContext,
  foliaUrl: string,
  verifyAudition?: (remote: Page) => Promise<void>,
) {
  const state = () => page.evaluate(() => (window as any).partyHost.api.playback.getState())
  const remote = await page.context().newPage()
  await remote.setViewportSize({ width: 380, height: 380 })
  await remote.exposeFunction('readPartySnapshot', () =>
    page.evaluate(() => (window as any).partyRemoteSnapshot),
  )
  await remote.exposeFunction('sendPartyCommand', (command: unknown) =>
    page.evaluate((value) => (window as any).partyRemote(value), command),
  )
  await remote.addInitScript(() => {
    localStorage.setItem('i18nextLng', 'zh-CN')
    const snapshot = async () => {
      const state = await (window as any).readPartySnapshot()
      return (window as any).partyRecordingOverride
        ? { ...state, exportState: (window as any).partyRecordingOverride }
        : state
    }
    ;(window as any).electron = {
      getRemoteControlSnapshot: snapshot,
      getRemoteControlAlwaysOnTop: async () => false,
      onRemoteControlSnapshot: (callback: any) => {
        const timer = setInterval(async () => callback(await snapshot()), 100)
        return () => clearInterval(timer)
      },
      sendRemoteControlCommand: (command: unknown) => (window as any).sendPartyCommand(command),
    }
  })
  await remote.route('**/*', (route) => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ||
      ['blob:', 'data:'].includes(url.protocol)
      ? route.continue()
      : route.fulfill({ contentType: 'application/json', body: '{}' })
  })
  await remote.goto(`${foliaUrl}?remote=1`)
  await remote.mouse.move(180, 310)
  const vote = remote.getByRole('button', { name: '为这首歌点赞', exact: true })
  await expect(vote).toBeVisible()
  await expect(remote.getByRole('button', { name: '上一首', exact: true })).toBeDisabled()
  await expect(remote.locator('input[type="range"]')).toBeDisabled()
  const before = await (await request.get('/test/state')).json()
  await vote.click()
  await expect
    .poll(async () => (await (await request.get('/test/state')).json()).likes)
    .toBe(before.likes + 1)
  await remote.screenshot({ path: 'test-results/folia-remote-room.png' })
  await verifyRemoteRecording(remote)

  const album = page.locator('[data-ponder-page-scope="grid-view-page"]')
  await album.getByRole('heading', { level: 2, name: /^海边专辑(?:\s|$)/ }).click()
  await album.getByRole('button', { name: '播放全部', exact: true }).click()
  await expect.poll(async () => (await state()).song?.id).toBe('701')
  await expect.poll(async () => (await state()).state).toBe('playing')
  await verifyAudition?.(remote)
  expect((await (await request.get('/test/state')).json()).current).toBe(before.current)
  expect(
    (await (await request.get('/test/state')).json()).operations.filter(
      (o: any) => o.operate === 1,
    ),
  ).toHaveLength(0)
  await expect(remote.getByRole('button', { name: '停止试听', exact: true })).toBeVisible()
  await expect(remote.getByRole('button', { name: '暂停', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '返回房间', exact: true })).toHaveCount(0)
  await expect(vote).toHaveCount(0)
  await expect(remote.locator('input[type="range"]')).toBeEnabled()
  await page.evaluate(() => (window as any).partyRemote({ type: 'seek', time: 25 }))
  await expect.poll(async () => (await state()).position).toBeGreaterThan(24)
  await remote.screenshot({ path: 'test-results/folia-remote-audition.png' })
  await remote.getByRole('button', { name: '停止试听', exact: true }).click()
  await expect.poll(async () => (await state()).song?.id).toBe(before.current)
  await expect.poll(async () => (await state()).state).toBe('paused')

  // Album playback keeps the collection open, and adding it is the separate room mutation.
  await album
    .locator('[data-ponder="online-collection-actions"]')
    .getByRole('button', { name: '加入播放队列', exact: true })
    .click()
  await expect
    .poll(
      async () =>
        (await (await request.get('/test/state')).json()).operations.filter(
          (o: any) => o.operate === 1,
        ).length,
    )
    .toBe(1)
  expect((await state()).song?.id).toBe(before.current)
  await remote.close()
}

export async function verifyPrivateSongChoices(page: Page, request: APIRequestContext) {
  const before = await (await request.get('/test/state')).json()
  const song = page.getByRole('button', { name: '试听或推荐 海边单曲', exact: true })
  await song.click()
  await page
    .getByRole('dialog', { name: '歌曲操作' })
    .getByRole('button', { name: '试听', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().song?.id))
    .toBe('701')
  expect((await (await request.get('/test/state')).json()).operations).toEqual(before.operations)
  await page.evaluate(() => (window as any).partyRemote({ type: 'next' }))
  await expect
    .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().song?.id))
    .toBe(before.current)
  expect((await (await request.get('/test/state')).json()).operations).toEqual(before.operations)
  await song.click()
  await page
    .getByRole('dialog', { name: '歌曲操作' })
    .getByRole('button', { name: '推歌', exact: true })
    .click()
  await expect
    .poll(
      async () =>
        (await (await request.get('/test/state')).json()).operations.filter(
          (o: any) => o.operate === 1,
        ).length,
    )
    .toBe(2)
}
