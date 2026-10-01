import { test, expect } from '@playwright/test'

// tests/browser/plugin.spec.ts
test.beforeEach(async ({ page, request }) => {
  await request.get('/test/reset')
  await page.route('https://p1.music.126.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><circle cx="15" cy="15" r="15" fill="green"/></svg>',
    }),
  )
})
async function restore(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await expect(page.locator('.mp-panel > .mp-header .mp-pill')).toHaveText('3 人一起听')
}
test('full queue, own deletion, official next and local cleanup', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await restore(page)
  await page.screenshot({ path: 'test-results/room.png', fullPage: true })
  await page.evaluate(() => (window as any).partyTest.openQueue())
  await expect(page.locator('.native-queue-entry')).toHaveCount(10)
  await expect(page.getByRole('button', { name: '删除我的推荐', exact: true })).toHaveCount(5)
  await page.getByRole('button', { name: '删除我的推荐', exact: true }).first().click()
  await expect(page.locator('.native-queue-entry')).toHaveCount(9)
  await page.getByRole('tab', { name: '房间', exact: true }).click()
  await page.evaluate(() => (window as any).partyTest.next())
  await expect.poll(async () => (await (await request.get('/test/state')).json()).current).toBe('2')
  await page.getByRole('button', { name: '退出房间', exact: true }).click()
  await expect(page.getByText('个人播放队列已恢复', { exact: false })).toBeVisible()
  expect((await (await request.get('/test/state')).json()).calls).toContain('operate:4')
  await page.evaluate(() => (window as any).partyTest.dispose())
  expect(errors).toEqual([])
})
test('safe message rendering, failed draft retention, sticker dismiss and private read/invite', async ({
  page,
  request,
}) => {
  await restore(page)
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await expect(page.getByText('这首歌适合在海边听。')).toBeVisible()
  const draft = page.getByRole('textbox', { name: '房间聊天内容' })
  await draft.fill('REJECT')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(draft).toHaveValue('REJECT')
  await expect(page.getByRole('alert')).toContainText('发送太频繁')
  await draft.fill('<img src=x onerror=alert(1)>')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByText('<img src=x onerror=alert(1)>', { exact: true })).toBeVisible()
  await page.locator('summary:visible').filter({ hasText: '表情' }).click()
  await expect(page.getByRole('button', { name: '开心', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await expect(page.getByRole('button', { name: '开心', exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  await expect(page.getByText('一起听这首吧', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '小岛', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '邀请一起听', exact: true }).click()
  await expect
    .poll(async () => (await (await request.get('/test/state')).json()).calls)
    .toContain('privateSend')
})
test('missing host bridge is visible and does not join rooms', async ({ page, request }) => {
  await page.goto('/?unpatched')
  await expect(
    page.getByText('此 Folia 尚未提供 playback.sessions 接口。', { exact: false }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复当前房间', exact: true })).not.toBeVisible()
  expect((await (await request.get('/test/state')).json()).calls).not.toContain('operate:4')
})

test('private viewport, scroll pagination, compact media and sticker management', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1100, height: 780 })
  await restore(page)
  await request.get('/test/private-pages')
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const home = page.locator('.mp-private-home')
  const contacts = home.locator('.mp-contacts'),
    history = home.locator('.mp-history')
  await expect(home.locator('.mp-contact')).toHaveCount(20)
  await expect(history.locator('.mp-message')).toHaveCount(25)
  await expect(history.locator('.mp-message').last().locator('.mp-bubble')).toHaveCount(0)
  await expect(history.locator('.mp-message').last().getByRole('img')).toBeVisible()
  await expect(home.getByRole('button', { name: '更多会话' })).toHaveCount(0)
  await expect(home.getByRole('button', { name: '更早的消息' })).toHaveCount(0)
  expect(await home.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true)
  expect(
    await home
      .locator('.mp-private-conversation')
      .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
  ).toBe(true)
  expect(
    await history
      .locator('.mp-bubble')
      .first()
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBeLessThan(400)
  await contacts.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await expect(home.locator('.mp-contact')).toHaveCount(40)
  await history.evaluate((node) => {
    node.scrollTop = 0
  })
  await expect(history.locator('.mp-message')).toHaveCount(50)
  expect(await history.evaluate((node) => node.scrollTop)).toBeGreaterThan(500)
  await home.locator('summary').filter({ hasText: 'Emoji' }).click()
  await home.getByRole('button', { name: '😊', exact: true }).click()
  await expect(home.getByRole('textbox', { name: '私信内容' })).toHaveValue('😊')
  await home.locator('summary').filter({ hasText: '表情包' }).click()
  await home.getByRole('button', { name: '开心', exact: true }).waitFor()
  await home.getByRole('button', { name: '整理', exact: true }).click()
  await home.getByRole('button', { name: '开心', exact: true }).click()
  await expect(home.getByRole('button', { name: '开心', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await home.getByRole('button', { name: '删除 (1)', exact: true }).click()
  await expect(home.getByRole('button', { name: '开心', exact: true })).toHaveCount(0)
  expect((await (await request.get('/test/state')).json()).calls).toContain('stickerDelete')
  await page.screenshot({ path: 'test-results/private-desktop.png' })
  await home.getByRole('heading', { name: '私信', exact: true }).click()
  await expect(home.getByRole('button', { name: '上传表情包' })).not.toBeVisible()
})

test('private tools upload targets, isolated feedback and narrow theme layout', async ({
  page,
}) => {
  await restore(page)
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const home = page.locator('.mp-private-home')
  await expect(home.locator('.mp-notice')).toHaveCount(0)
  const uploads: any[] = []
  await page.route('**/rpc', async (route) => {
    const request = route.request().postDataJSON()
    if (request.name !== 'media') return route.continue()
    uploads.push(request.args[0])
    return route.fulfill({ json: { ok: true, result: { ok: true } } })
  })
  const file = {
    name: 'test.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
  }
  await home.locator('summary').filter({ hasText: '图片' }).click()
  await home.locator('.mp-image-picker input').setInputFiles(file)
  await expect.poll(() => uploads.length).toBe(1)
  expect(uploads[0].target).toEqual({ kind: 'private', uid: '10' })
  await home.locator('summary').filter({ hasText: '表情包' }).click()
  await home.getByRole('button', { name: '开心', exact: true }).waitFor()
  await home.locator('.mp-sticker-content:has(.mp-picker-header) input').setInputFiles(file)
  await expect.poll(() => uploads.length).toBe(2)
  expect(uploads[1].target).toEqual({ kind: 'sticker' })
  await home.getByRole('button', { name: '整理', exact: true }).click()
  await home.getByRole('button', { name: '开心', exact: true }).click()
  await home.getByRole('button', { name: '取消', exact: true }).click()
  await expect(home.getByRole('button', { name: '删除 (0)', exact: true })).not.toBeVisible()
  await page.keyboard.press('Escape')
  await expect(home.getByRole('button', { name: '上传表情包' })).not.toBeVisible()
  await page.setViewportSize({ width: 640, height: 640 })
  await page.locator('#private-home').evaluate((node) => {
    node.style.setProperty('--folium-bg', '#fafaf7')
    node.style.setProperty('--folium-primary', '#222222')
    node.style.color = '#222222'
    node.style.background = '#fafaf7'
  })
  await home.locator('summary').filter({ hasText: '颜文字' }).click()
  const bounds = await home.locator('.mp-text-picker:visible').boundingBox()
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(640)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(
    await home.evaluate(
      (node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight,
    ),
  ).toBe(true)
  await page.screenshot({ path: 'test-results/private-light-narrow.png' })
})

test('room overview and member recommendation history with own-only deletion', async ({
  page,
  request,
}) => {
  await restore(page)
  await expect(page.getByRole('heading', { name: '房间信息' })).toBeVisible()
  await expect(page.getByRole('button', { name: '请求下一首' })).toHaveCount(0)
  await page.getByRole('tab', { name: '成员', exact: true }).click()
  const view = page.locator('section[aria-label="成员"]')
  await expect(view.getByRole('heading', { name: '3 人一起听' })).toBeVisible()
  await expect(view.getByRole('button', { name: '查看 晚风 的推荐' })).toContainText('推荐 9 首')
  await view.getByRole('button', { name: '查看 小岛 的推荐' }).click()
  await expect(view.getByText('共推荐 6 首')).toBeVisible()
  await expect(view.getByRole('heading', { name: '已播歌曲 · 2' })).toBeVisible()
  await expect(view.getByText('4 赞', { exact: true })).toBeVisible()
  await expect(view.getByRole('button', { name: '删除', exact: true })).toHaveCount(0)
  await expect(view.getByRole('button', { name: '置顶', exact: true })).toHaveCount(4)
  await view.getByRole('button', { name: '返回', exact: true }).click()
  await view.getByRole('button', { name: '查看 晚风 的推荐' }).click()
  await expect(view.getByRole('heading', { name: '正在播放', exact: true })).toHaveCount(0)
  await expect(view.getByRole('button', { name: '删除', exact: true })).toHaveCount(5)
  await view.getByRole('button', { name: '删除', exact: true }).first().click()
  await expect(view.getByRole('button', { name: '删除', exact: true })).toHaveCount(4)
  await expect(view.getByText('共推荐 8 首')).toBeVisible()
  await view.getByRole('button', { name: '置顶', exact: true }).first().click()
  await expect
    .poll(async () => (await (await request.get('/test/state')).json()).calls)
    .toContain('operate:2')
  await page.screenshot({ path: 'test-results/member-recommendations.png' })
})

test('automatic account activation and provider gating without manual connection', async ({
  page,
}) => {
  await page.goto('/?loggedout')
  await expect(page.getByRole('button', { name: '私信', exact: true })).not.toBeVisible()
  await expect(page.getByRole('button', { name: '一起听', exact: true })).not.toBeVisible()
  await expect(page.getByRole('button', { name: '连接网易云账号', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '模拟登录网易云' }).click()
  await expect(page.getByRole('button', { name: '私信', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复当前房间', exact: true })).toBeVisible()
  await expect(page.getByRole('tablist', { name: '一起听功能' })).not.toBeVisible()
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await expect(page.getByRole('tab', { name: '成员', exact: true })).toBeVisible()
  await page.getByRole('combobox', { name: '模拟音乐来源' }).selectOption('qq')
  await expect(page.getByRole('button', { name: '私信', exact: true })).not.toBeVisible()
  await expect(page.getByRole('button', { name: '一起听', exact: true })).not.toBeVisible()
  await page.getByRole('combobox', { name: '模拟音乐来源' }).selectOption('netease')
  await expect(page.getByRole('button', { name: '恢复当前房间', exact: true })).toBeVisible()
  await expect(page.getByRole('tablist', { name: '一起听功能' })).not.toBeVisible()
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await expect(page.getByRole('button', { name: '小岛 · 1 未读', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '模拟退出登录' }).click()
  await expect(page.locator('.mp-private-home')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '私信', exact: true })).not.toBeVisible()
})

test('lobby cards show only an existing room and separate link joining from creation', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '继续一起听' })).toBeVisible()
  await expect(page.getByText('已连接网易云账号，可以创建、加入或恢复多人房间。')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '加入朋友的房间' })).toBeVisible()
  await expect(page.getByRole('switch', { name: '允许陌生人匹配' })).toBeVisible()
  await request.post('/test/empty')
  await page.reload()
  await expect(page.getByRole('button', { name: '匹配房间', exact: true })).toBeEnabled()
  await expect(page.getByRole('heading', { name: '继续一起听' })).toBeHidden()
  await expect(page.getByRole('button', { name: '恢复当前房间', exact: true })).toBeHidden()
  await page.getByRole('button', { name: '匹配房间', exact: true }).click()
  await expect(page.getByRole('button', { name: '取消匹配', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '取消匹配', exact: true }).click()
  await expect(page.getByRole('button', { name: '匹配房间', exact: true })).toBeVisible()
})
