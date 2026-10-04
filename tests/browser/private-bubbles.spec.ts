import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateNotificationFixture } from './private-notification-fixture'

// tests/browser/private-bubbles.spec.ts
const readPath = '/api/communication/msg/unread/count/clean'
const calls = async (request: APIRequestContext): Promise<string[]> =>
  (await (await request.get('/test/state')).json()).calls
const readCount = async (request: APIRequestContext) =>
  (await calls(request)).filter((call) => call === readPath).length
const bubble = (page: Page, name = '小岛') => page.getByRole('dialog', { name: `与${name}对话` })
const avatar = (page: Page, name = '小岛') =>
  page.locator('.mp-private-bubble-rail').getByRole('button', { name: `与${name}对话` })
async function screenshot(page: Page, name: string) {
  // Keep visual evidence across subsequent Playwright runs, which clear their output directory.
  const directory = join(tmpdir(), 'music-party-private-bubbles'),
    path = join(directory, `${name}.png`)
  await mkdir(directory, { recursive: true })
  await page.screenshot({ path })
  await test.info().attach(name, { path, contentType: 'image/png' })
}
async function consumed(
  notifications: Awaited<ReturnType<typeof privateNotificationFixture>>,
  sequence: number,
) {
  await expect
    .poll(() => notifications.polls.some((poll) => poll.cursor >= sequence), { timeout: 4000 })
    .toBe(true)
}
async function start(page: Page) {
  const notifications = await privateNotificationFixture(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: '私信', exact: true })).toBeVisible()
  await expect.poll(() => notifications.polls.length).toBeGreaterThan(0)
  return notifications
}
test.beforeEach(async ({ page, request }) => {
  await request.get('/test/reset')
  await page.route('https://p1.music.126.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>',
    }),
  )
})

test('a player notification opens a conversation, shows real presence and sends only with Ctrl+Enter', async ({
  page,
  request,
}) => {
  const notifications = await start(page)
  notifications.push('播放页收到的私信')
  const toast = page.locator('.mp-private-toast')
  await expect(toast.getByRole('button', { name: '回复 小岛' })).toBeVisible()
  await expect(toast.locator('.mp-presence-dot')).toBeVisible()
  expect(await calls(request)).toContain('privatePeer:10')
  expect(await readCount(request)).toBe(0)
  await toast.getByRole('button', { name: '回复 小岛' }).click()
  const dialog = bubble(page),
    draft = dialog.getByRole('textbox', { name: '私信内容' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('播放页收到的私信', { exact: true })).toBeVisible()
  await expect(dialog.locator('.mp-peer-avatar .mp-presence-dot')).toBeVisible()
  await expect(page.locator('.mp-private-home')).toHaveCount(0)
  await draft.fill('第一行')
  await draft.press('Enter')
  await draft.pressSequentially('第二行')
  await expect(draft).toHaveValue('第一行\n第二行')
  expect(await calls(request)).not.toContain('privateSend')
  await draft.press('Control+Enter')
  await expect(draft).toHaveValue('')
  await expect(dialog.locator('.mp-message.is-mine .mp-bubble')).toHaveText('第一行\n第二行')
  expect((await calls(request)).filter((call) => call === 'privateSend')).toHaveLength(1)
  await expect.poll(() => readCount(request)).toBeGreaterThan(0)
  await screenshot(page, 'player-private-reply')
})

test('minimizing preserves the draft and new unread messages until the bubble is opened again', async ({
  page,
  request,
}) => {
  const notifications = await start(page)
  notifications.push('先打开对话')
  await page.getByRole('button', { name: '回复 小岛' }).click()
  const dialog = bubble(page),
    draft = dialog.getByRole('textbox', { name: '私信内容' })
  await expect(dialog.getByText('先打开对话', { exact: true })).toBeVisible()
  await expect.poll(() => readCount(request)).toBe(1)
  await draft.fill('保留在气泡中的草稿')
  await dialog.getByRole('button', { name: '收起对话', exact: true }).click()
  await expect(dialog).toBeHidden()
  const before = await readCount(request),
    sequence = notifications.push('收起后收到的新消息')
  await consumed(notifications, sequence)
  await expect(avatar(page).locator('.mp-dm-unread')).toHaveText('1')
  expect(await readCount(request)).toBe(before)
  await page.evaluate(() => (window as any).partyTest.remountStage())
  await avatar(page).click()
  await expect(draft).toHaveValue('保留在气泡中的草稿')
  await expect(dialog.getByText('收起后收到的新消息', { exact: true })).toBeVisible()
  await expect(avatar(page).locator('.mp-dm-unread')).toHaveCount(0)
  await draft.press('Control+Enter')
  await expect(dialog.locator('.mp-message.is-mine .mp-bubble')).toHaveText('保留在气泡中的草稿')
  await dialog.getByRole('button', { name: '关闭对话', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(avatar(page)).toHaveCount(0)
})

test('self echoes, sync and duplicate notices never create another toast or unread count', async ({
  page,
  request,
}) => {
  const notifications = await start(page)
  notifications.sync()
  const self = notifications.push('自己的回声', { self: true })
  await consumed(notifications, self)
  await expect(page.locator('.mp-private-toast')).toHaveCount(0)
  await expect(page.locator('.mp-private-bubble')).toHaveCount(0)
  const sequence = notifications.push('只提醒一次')
  await expect(page.getByRole('button', { name: '回复 小岛' })).toBeVisible()
  await page.getByRole('button', { name: '关闭通知', exact: true }).click()
  await consumed(notifications, notifications.repeat(sequence))
  await expect(page.locator('.mp-private-toast')).toHaveCount(0)
  await expect(avatar(page).locator('.mp-dm-unread')).toHaveText('1')
  expect(await readCount(request)).toBe(0)
})

test('notifications received outside the player or in a hidden window never show toasts or mark read', async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    ;(window as any).privateTestVisible = true
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => ((window as any).privateTestVisible ? 'visible' : 'hidden'),
    })
  })
  const notifications = await start(page)
  await page.evaluate(() => (window as any).partyTest.setStageDisplay({ showText: false }))
  await consumed(notifications, notifications.push('其他页面收到'))
  await expect(page.locator('.mp-private-toast')).toHaveCount(0)
  await expect(avatar(page)).toBeHidden()
  await page.evaluate(() => {
    ;(window as any).privateTestVisible = false
    ;(window as any).partyTest.setStageDisplay({ showText: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await consumed(notifications, notifications.push('窗口隐藏时收到', { peerUid: '11' }))
  await expect(page.locator('.mp-private-toast')).toHaveCount(0)
  expect(await readCount(request)).toBe(0)
  await page.evaluate(() => {
    ;(window as any).privateTestVisible = true
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(avatar(page)).toBeVisible()
  await expect(avatar(page, '远山')).toBeVisible()
  await expect(page.locator('.mp-private-toast')).toHaveCount(0)
  expect(await readCount(request)).toBe(0)
})

test('only explicit online peers get a green indicator in player bubbles and the full inbox', async ({
  page,
  request,
}) => {
  await request.get('/test/private-pages')
  const notifications = await start(page)
  for (const peerUid of ['10', '11', '12']) notifications.push('在线状态测试', { peerUid })
  await expect(avatar(page).locator('.mp-presence-dot')).toBeVisible()
  await expect.poll(async () => (await calls(request)).includes('privatePeer:12')).toBe(true)
  await expect(avatar(page, '远山').locator('.mp-presence-dot')).toHaveCount(0)
  await expect(avatar(page, '云影').locator('.mp-presence-dot')).toHaveCount(0)
  await page.getByRole('button', { name: '私信', exact: true }).click()
  const contacts = page.locator('.mp-private-home .mp-contacts')
  await expect(contacts.locator('[data-uid="10"] .mp-presence-dot')).toBeVisible()
  await expect(contacts.locator('[data-uid="11"] .mp-presence-dot')).toHaveCount(0)
  await expect(contacts.locator('[data-uid="12"] .mp-presence-dot')).toHaveCount(0)
})

test('bubbles avoid bottom controls, fit a smaller window and discard account-specific UI on switch', async ({
  page,
  request,
}) => {
  const notifications = await start(page)
  notifications.push('窗口与账号隔离测试')
  await page.getByRole('button', { name: '回复 小岛' }).click()
  const dialog = bubble(page),
    draft = dialog.getByRole('textbox', { name: '私信内容' })
  await expect(dialog).toBeVisible()
  await draft.fill('只属于旧账号的草稿')
  await page.evaluate(() => {
    const controls = document.createElement('div')
    controls.dataset.playerBottomObstacle = ''
    controls.style.cssText = 'position:fixed;bottom:0;right:0;width:100%;height:112px'
    document.body.append(controls)
  })
  await page.setViewportSize({ width: 430, height: 740 })
  await expect
    .poll(async () => {
      const rect = (await dialog.boundingBox())!
      return rect.x >= 8 && rect.x + rect.width <= 422 && rect.y >= 8
    })
    .toBe(true)
  await expect
    .poll(async () => {
      const rect = (await avatar(page).boundingBox())!,
        controls = (await page.locator('[data-player-bottom-obstacle]').boundingBox())!
      return controls.y - rect.y - rect.height
    })
    .toBeGreaterThanOrEqual(8)
  await expect(draft).toHaveValue('只属于旧账号的草稿')
  await expect(dialog.getByRole('button', { name: '发送', exact: true })).toBeVisible()
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await screenshot(page, 'private-bubble-narrow')
  await request.get('/test/account?uid=19')
  notifications.resetAccount()
  await page.evaluate(() => {
    localStorage.setItem('online_provider:netease:cookie', 'MUSIC_U=second-test-account')
    window.dispatchEvent(new Event('storage'))
  })
  await expect(page.locator('.mp-private-bubble')).toHaveCount(0)
  await expect(page.locator('.mp-private-toast')).toHaveCount(0)
  await expect(page.locator('.mp-private-bubble-body')).toHaveCount(0)
})

test('an older read response does not clear a newer same-millisecond message received while minimized', async ({
  page,
  request,
}) => {
  const notifications = await start(page)
  let pending = false,
    returned = false,
    releaseRead!: () => void
  const holdRead = new Promise<void>((resolve) => {
    releaseRead = resolve
  })
  await page.route('**/rpc', async (route) => {
    const body = route.request().postDataJSON()
    if (body.name !== 'call' || body.args[0]?.method !== 'privateRead' || pending)
      return route.fallback()
    const response = await route.fetch()
    pending = true
    await holdRead
    await route.fulfill({ response })
    returned = true
  })
  try {
    const timestamp = Date.now()
    notifications.push('请求已读时已经加载的消息', { timestamp })
    await page.getByRole('button', { name: '回复 小岛' }).click()
    await expect.poll(() => pending).toBe(true)
    await bubble(page).getByRole('button', { name: '收起对话', exact: true }).click()
    await consumed(notifications, notifications.push('同毫秒但尚未读取的新消息', { timestamp }))
    await expect(avatar(page).locator('.mp-dm-unread')).toHaveText('2')
    await expect(page.locator('.mp-private-toast')).toContainText('同毫秒但尚未读取的新消息')
    releaseRead()
    await expect.poll(() => returned).toBe(true)
    await expect(avatar(page).locator('.mp-dm-unread')).toHaveText('1')
    await expect(page.locator('.mp-private-toast')).toContainText('同毫秒但尚未读取的新消息')
    expect(await readCount(request)).toBe(1)
    await expect(bubble(page)).toBeHidden()
  } finally {
    releaseRead()
  }
})

test('another peer notification stays above an open dialog and short windows use only the unread rail', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 })
  const notifications = await start(page)
  notifications.push('保持这个对话打开')
  await page.getByRole('button', { name: '回复 小岛' }).click()
  const dialog = bubble(page)
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: '私信内容' }).fill('正在输入的内容')
  notifications.push('另一位好友发来的通知', { peerUid: '11' })
  const toast = page.locator('.mp-private-toast')
  await expect(toast.getByRole('button', { name: '回复 远山' })).toBeVisible()
  await expect
    .poll(async () => {
      const notice = (await toast.boundingBox())!,
        conversation = (await dialog.boundingBox())!
      return conversation.y - notice.y - notice.height
    })
    .toBeGreaterThanOrEqual(8)
  notifications.push('第三位好友的通知', { peerUid: '12' })
  await expect(toast.getByRole('button', { name: '回复 云影' })).toBeVisible()
  await expect(toast).toHaveCount(1)
  await expect(avatar(page, '远山').locator('.mp-dm-unread')).toHaveText('1')
  await screenshot(page, 'private-bubble-toast-720')
  await page.setViewportSize({ width: 430, height: 480 })
  await expect(toast).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: '私信内容' })).toHaveValue('正在输入的内容')
  await expect(dialog.getByRole('button', { name: '发送', exact: true })).toBeVisible()
  await consumed(notifications, notifications.push('短窗口中只累加未读', { peerUid: '11' }))
  await expect(avatar(page, '远山').locator('.mp-dm-unread')).toHaveText('2')
  await expect(page.locator('.mp-private-toast:visible')).toHaveCount(0)
  const bounds = (await dialog.boundingBox())!
  expect(bounds.y).toBeGreaterThanOrEqual(8)
  expect(bounds.y + bounds.height).toBeLessThan(480)
  await screenshot(page, 'private-bubble-compact-480')
})

test('private bubbles stay at the top right below changing and faded titlebar controls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 })
  const notifications = await start(page)
  await page.evaluate(() => {
    ;(window as any).partyTest.setStageDisplay({ isPanelOpen: false })
    const titlebar = document.createElement('div')
    titlebar.id = 'test-titlebar'
    titlebar.style.cssText =
      'position:fixed;top:0;right:0;width:220px;height:40px;-webkit-app-region:no-drag;opacity:0'
    document.body.append(titlebar)
  })
  notifications.push('右上角的通知')
  const rail = page.locator('.mp-private-bubble-rail')
  await expect(avatar(page)).toBeVisible()
  await expect.poll(async () => (await rail.boundingBox())!.y).toBe(52)
  expect((await rail.boundingBox())!.x).toBeGreaterThan(1000)
  await page.evaluate(() => {
    const titlebar = document.getElementById('test-titlebar')!
    titlebar.style.height = '72px'
    titlebar.style.opacity = '1'
  })
  await expect.poll(async () => (await rail.boundingBox())!.y).toBe(84)
  await page.getByRole('button', { name: '回复 小岛' }).click()
  const dialog = bubble(page)
  await expect
    .poll(async () => (await dialog.boundingBox())!.y - (await rail.boundingBox())!.y)
    .toBe(66)
  const bounds = (await dialog.boundingBox())!
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(696)
  await screenshot(page, 'private-bubble-top-right')
})

test('stacked notifications stay inside a short player before a conversation is opened', async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 300 })
  const notifications = await start(page)
  notifications.push('短窗口的第一条通知')
  notifications.push('短窗口的第二条通知', { peerUid: '11' })
  notifications.push('短窗口的第三条通知', { peerUid: '12' })
  await expect(page.locator('.mp-private-toast')).toHaveCount(3)
  const list = page.locator('.mp-private-toast-list')
  await expect
    .poll(async () => {
      const bounds = (await list.boundingBox())!
      return bounds.y + bounds.height
    })
    .toBeLessThanOrEqual(288)
  await expect(page.locator('.mp-private-bubble-dialog')).toBeHidden()
  await expect(avatar(page, '云影')).toBeVisible()
})

test('private bubble composer tools open beside the conversation and adapt to a compact player', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await request.post('/test/sticker-pages')
  const notifications = await start(page)
  await page.evaluate(() => {
    ;(window as any).partyTest.setStageDisplay({ isPanelOpen: false })
    // Native panels retain their expanded maximum height and bottom baseline,
    // even when their current content is much shorter than the player.
    const panel = document.getElementById('panel')!
    panel.style.cssText =
      'position:fixed;right:24px;bottom:32px;margin:0;max-height:calc(100dvh - 88px)'
  })
  notifications.push('检查私信工具的位置')
  await page.getByRole('button', { name: '回复 小岛' }).click()
  const dialog = bubble(page)
  await expect(dialog).toBeVisible()
  const toolNames = ['Emoji', '颜文字', '表情包', '图片']
  for (const name of toolNames) {
    await dialog
      .locator('summary')
      .filter({ hasText: new RegExp(`^${name}$`) })
      .click()
    const popup = dialog.getByRole('dialog', { name, exact: true })
    await expect(popup).toBeVisible()
    await expect
      .poll(async () => {
        const tools = (await popup.boundingBox())!,
          conversation = (await dialog.boundingBox())!
        return Math.round(conversation.x - tools.x - tools.width)
      })
      .toBe(12)
    if (name === '表情包') {
      const list = popup.locator('.mp-sticker-scroll')
      await expect(list.locator('.mp-sticker-grid > button')).toHaveCount(24)
      await list.hover()
      await page.mouse.wheel(0, 2000)
      await expect(list.locator('.mp-sticker-grid > button')).toHaveCount(32)
      await expect
        .poll(async () => {
          const rect = (await popup.boundingBox())!
          return rect.y >= 56 && rect.y + rect.height <= 868
        })
        .toBe(true)
      await screenshot(page, 'private-bubble-stickers-beside')
    }
    if (name === '图片') {
      await popup.locator('input[type="file"]').setInputFiles({
        name: 'preview.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jkX0AAAAASUVORK5CYII=',
          'base64',
        ),
      })
      await expect(popup.getByAltText('待发送图片预览')).toBeVisible()
      await expect(popup.getByRole('button', { name: '发送图片', exact: true })).toBeInViewport()
    }
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()
  }
  await page.setViewportSize({ width: 430, height: 480 })
  for (const name of toolNames) {
    await dialog
      .locator('summary')
      .filter({ hasText: new RegExp(`^${name}$`) })
      .click()
    const popup = dialog.getByRole('dialog', { name, exact: true })
    await expect(popup).toBeVisible()
    await expect
      .poll(async () => {
        const rect = (await popup.boundingBox())!
        return (
          rect.x >= 8 && rect.x + rect.width <= 422 && rect.y >= 8 && rect.y + rect.height <= 472
        )
      })
      .toBe(true)
    await page.keyboard.press('Escape')
  }
  await dialog
    .locator('summary')
    .filter({ hasText: /^Emoji$/ })
    .click()
  await dialog.getByRole('button', { name: '收起对话', exact: true }).click()
  await expect(page.locator('.mp-private-bubble-dialog :popover-open')).toHaveCount(0)
  expect((await calls(request)).filter((name) => name === 'privateSend')).toHaveLength(0)
})
