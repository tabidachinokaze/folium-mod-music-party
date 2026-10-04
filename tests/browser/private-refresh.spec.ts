import { expect, test } from '@playwright/test'
import { privateNotificationFixture } from './private-notification-fixture'

// tests/browser/private-refresh.spec.ts
test('the local private feed is consumed without a mounted inbox, player surface or window focus', async ({
  page,
  request,
}) => {
  await request.get('/test/reset')
  const notifications = await privateNotificationFixture(page)
  await page.addInitScript(() => {
    ;(window as any).privateTestFocused = true
    ;(window as any).privateTestVisible = true
    document.hasFocus = () => (window as any).privateTestFocused
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => ((window as any).privateTestVisible ? 'visible' : 'hidden'),
    })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: '私信', exact: true })).toBeVisible()
  await expect(page.locator('.mp-private-home')).toHaveCount(0)
  await expect.poll(() => notifications.polls.length).toBeGreaterThan(0)
  const playingSequence = notifications.push('播放页面后台收到')
  await expect
    .poll(() => notifications.polls.some((poll) => poll.cursor >= playingSequence), {
      timeout: 4000,
    })
    .toBe(true)
  await page.evaluate(() => {
    ;(window as any).partyTest.setStageDisplay({ showText: false })
    ;(window as any).privateTestFocused = false
    ;(window as any).privateTestVisible = false
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('blur'))
  })
  const hiddenSequence = notifications.push('切离播放器后后台收到')
  await expect
    .poll(() => notifications.polls.some((poll) => poll.cursor >= hiddenSequence), {
      timeout: 4000,
    })
    .toBe(true)
  const calls: string[] = (await (await request.get('/test/state')).json()).calls
  expect(calls.filter((call) => /^(contacts|history):/.test(call))).toEqual([])
  expect(calls).not.toContain('/api/communication/msg/unread/count/clean')
  await expect(page.locator('.mp-private-home')).toHaveCount(0)
  await page.evaluate(() => {
    ;(window as any).privateTestFocused = true
    ;(window as any).privateTestVisible = true
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  await expect(page.getByText('播放页面后台收到', { exact: true })).toBeVisible()
  await expect(page.getByText('切离播放器后后台收到', { exact: true })).toBeVisible()
})

test('a background notice refreshes the open conversation without losing history, media, draft or scroll', async ({
  page,
  request,
}) => {
  await request.get('/test/reset')
  await request.get('/test/private-pages')
  const notifications = await privateNotificationFixture(page)
  await page.route('https://p1.music.126.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>',
    }),
  )
  await page.goto('/')
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const home = page.locator('.mp-private-home'),
    history = home.locator('.mp-history'),
    contacts = home.locator('.mp-contacts'),
    draft = home.getByRole('textbox', { name: '私信内容' })
  await expect(history.locator('.mp-message')).toHaveCount(25)
  const media = history.locator('.mp-message-content > img').last()
  await expect(media).toBeVisible()
  await media.evaluate((node) => {
    ;(window as any).originalPrivateMedia = node
  })
  await history.evaluate((node) => {
    node.scrollTop = 0
  })
  await expect(history.locator('.mp-message')).toHaveCount(50)
  await contacts.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await expect(contacts.locator('.mp-contact')).toHaveCount(40)
  await history.evaluate((node) => {
    node.scrollTop = 300
  })
  await draft.fill('保留这份草稿')
  const top = await history.evaluate((node) => node.scrollTop)
  const readsBefore = (await (await request.get('/test/state')).json()).calls.filter(
    (value: string) => value === '/api/communication/msg/unread/count/clean',
  ).length
  notifications.push('自动收到的新私信')
  // No focus wake-up or manual refresh: a 1 s local-feed poll invalidates the visible view.
  await expect(history.getByText('自动收到的新私信', { exact: true })).toHaveCount(1, {
    timeout: 4000,
  })
  await expect(history.locator('.mp-message')).toHaveCount(51)
  await expect(contacts.locator('.mp-contact')).toHaveCount(40)
  await expect(draft).toHaveValue('保留这份草稿')
  await expect(draft).toBeEnabled()
  expect(await history.evaluate((node) => Math.abs(node.scrollTop - 300))).toBeLessThanOrEqual(1)
  expect(await history.evaluate((node) => node.scrollTop)).toBe(top)
  expect(await media.evaluate((node) => node === (window as any).originalPrivateMedia)).toBe(true)
  expect(
    (await (await request.get('/test/state')).json()).calls.filter(
      (value: string) => value === '/api/communication/msg/unread/count/clean',
    ).length,
  ).toBe(readsBefore)
  await page.screenshot({ path: test.info().outputPath('private-auto-refresh.png') })
})

test('a hidden inbox consumes notices without HTTP refresh or read receipts and refreshes on return', async ({
  page,
  request,
}) => {
  await request.get('/test/reset')
  const notifications = await privateNotificationFixture(page)
  await page.goto('/')
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  await expect(page.getByText('一起听这首吧', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '小岛', exact: true })).toBeVisible()
  const home = page.locator('.mp-private-home'),
    draft = home.getByRole('textbox', { name: '私信内容' })
  await draft.fill('切页后继续编辑')
  await page.getByRole('button', { name: '一起听', exact: true }).click()
  await expect(home).toBeHidden()
  const before: string[] = (await (await request.get('/test/state')).json()).calls,
    privateCalls = (calls: string[]) =>
      calls.filter(
        (call) =>
          /^(contacts|history):/.test(call) || call === '/api/communication/msg/unread/count/clean',
      )
  const sequence = notifications.push('页面隐藏时收到')
  await expect
    .poll(() => notifications.polls.some((poll) => poll.cursor >= sequence), { timeout: 4000 })
    .toBe(true)
  expect(privateCalls((await (await request.get('/test/state')).json()).calls)).toEqual(
    privateCalls(before),
  )
  await expect(home.getByText('页面隐藏时收到', { exact: true })).toHaveCount(0)
  // Reveal the existing host surface, preserving the already mounted editor and message nodes.
  await page.evaluate(() => {
    document.querySelector<HTMLElement>('#private-home')!.hidden = false
    document.querySelector<HTMLElement>('#panel')!.hidden = true
    ;(window as any).partyTest.setStageDisplay({ showText: false })
    window.dispatchEvent(new Event('focus'))
  })
  await expect(home.getByText('页面隐藏时收到', { exact: true })).toBeVisible({ timeout: 4000 })
  await expect(draft).toHaveValue('切页后继续编辑')
})

test('opening while unfocused defers read acknowledgement until focus returns', async ({
  page,
  request,
}) => {
  await request.get('/test/reset')
  await page.addInitScript(() => {
    ;(window as any).privateTestFocused = false
    document.hasFocus = () => (window as any).privateTestFocused
  })
  await page.goto('/')
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  await expect(page.getByText('一起听这首吧', { exact: true })).toBeVisible()
  const reads = async () =>
    (await (await request.get('/test/state')).json()).calls.filter(
      (value: string) => value === '/api/communication/msg/unread/count/clean',
    ).length
  expect(await reads()).toBe(0)
  await page.evaluate(() => {
    ;(window as any).privateTestFocused = true
    window.dispatchEvent(new Event('focus'))
  })
  await expect.poll(reads).toBe(1)
  await expect(page.getByRole('button', { name: '小岛', exact: true })).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForTimeout(1100)
  expect(await reads()).toBe(1)
})

test('a newly received image keeps the latest message visible after delayed loading', async ({
  page,
  request,
}) => {
  await request.get('/test/reset')
  await request.get('/test/private-pages')
  let incoming = false,
    requested = false,
    releaseImage!: () => void
  const imageReady = new Promise<void>((resolve) => {
    releaseImage = resolve
  })
  await page.route('https://p1.music.126.net/**', async (route) => {
    const delayed = route.request().url().includes('delayed-private')
    if (delayed) {
      requested = true
      await imageReady
    }
    await route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="${delayed ? 800 : 80}"/>`,
    })
  })
  await page.route('**/rpc', async (route) => {
    const body = route.request().postDataJSON(),
      call = body.args[0]
    if (body.name !== 'call' || call?.method !== 'privateHistory' || call.args.before || !incoming)
      return route.continue()
    const response = await route.fetch(),
      json = await response.json()
    json.result.data.msgs.push({
      id: 99002,
      time: 1890000000001,
      fromUser: { userId: 10, nickname: '小岛' },
      toUser: { userId: 9 },
      msg: JSON.stringify({
        pics: [{ url: 'https://p1.music.126.net/fixture/delayed-private.svg' }],
      }),
    })
    await route.fulfill({ json })
  })
  try {
    await page.goto('/')
    await page.getByRole('button', { name: '私信', exact: true }).click()
    await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
    const history = page.locator('.mp-private-home .mp-history')
    await expect(history.locator('.mp-message')).toHaveCount(25)
    await expect
      .poll(() =>
        history
          .locator('img')
          .last()
          .evaluate((node) => (node as HTMLImageElement).naturalWidth),
      )
      .toBe(180)
    incoming = true
    await page.waitForTimeout(1100)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => requested).toBe(true)
    releaseImage()
    await expect
      .poll(() =>
        history
          .locator('img[src*="delayed-private"]')
          .evaluate((node) => (node as HTMLImageElement).naturalHeight),
      )
      .toBe(800)
    await expect
      .poll(() =>
        history.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
      )
      .toBeLessThanOrEqual(1)
  } finally {
    releaseImage()
  }
})
