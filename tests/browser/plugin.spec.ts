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
  await expect(page.getByText('当前音乐继续播放', { exact: false })).toBeVisible()
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
  await page.locator('summary[aria-label="表情包"]:visible').click()
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
  await expect(page.getByText('请升级到 Folia 0.7.13', { exact: false })).toBeVisible()
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
  await expect(
    history.locator('.mp-message').last().locator('.mp-message-content > img'),
  ).toBeVisible()
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
  await expect(home.getByRole('img', { name: '待发送图片预览' })).toBeVisible()
  expect(uploads).toHaveLength(0)
  await home
    .locator('.mp-image-picker')
    .getByRole('button', { name: '发送图片', exact: true })
    .click()
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

test('private message cards show sender avatars, compact bubbles and integrated invitations', async ({
  page,
  request,
}) => {
  await request.post('/test/private-layout')
  await restore(page)
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const history = page.getByLabel('聊天消息')
  await expect(history.locator('.mp-message')).toHaveCount(5)
  await expect(history.locator('.mp-message-avatar img')).toHaveCount(5)
  const mine = history.locator('.mp-message.is-mine'),
    received = history
      .locator('.mp-message')
      .filter({ has: page.getByText('今晚听这首', { exact: true }) })
  await expect(mine.locator('.mp-bubble')).toHaveText('好呀')
  await expect(received.locator('.mp-meta')).toContainText('小岛')
  await expect(mine.locator('.mp-meta')).toContainText('晚风')
  await expect(mine.locator('.mp-meta time')).toHaveText(/^\d{2}-\d{2} \d{2}:\d{2}$/)
  const ownAvatar = (await mine.locator('.mp-message-avatar').boundingBox())!,
    ownBubble = (await mine.locator('.mp-bubble').boundingBox())!,
    peerAvatar = (await received.locator('.mp-message-avatar').boundingBox())!,
    peerBubble = (await received.locator('.mp-bubble').boundingBox())!
  expect(ownAvatar.x).toBeGreaterThan(ownBubble.x + ownBubble.width)
  expect(peerAvatar.x + peerAvatar.width).toBeLessThan(peerBubble.x)
  expect(ownBubble.width).toBeLessThan(150)
  await expect(history.locator('[data-message-id="server:504"] .mp-bubble')).toHaveCount(0)
  await expect(
    history.locator('[data-message-id="server:504"] .mp-message-content > img'),
  ).toBeVisible()
  await expect(
    history
      .locator('[data-message-id="server:505"] .mp-message-content')
      .getByRole('button', { name: '加入多人房间' }),
  ).toBeVisible()
  await history.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await page.screenshot({ path: 'test-results/private-message-cards.png', animations: 'disabled' })
  for (const theme of ['light', 'blue']) {
    await page.getByRole('combobox', { name: '预览主题' }).selectOption(theme)
    await page.setViewportSize({ width: 420, height: 760 })
    await expect
      .poll(() => history.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
      .toBe(true)
    await expect
      .poll(() =>
        page
          .locator('.mp-private-home')
          .evaluate((node) => node.scrollHeight <= node.clientHeight + 1),
      )
      .toBe(true)
  }
  await page.screenshot({
    path: 'test-results/private-message-cards-narrow.png',
    animations: 'disabled',
  })
  expect((await (await request.get('/test/state')).json()).calls).not.toContain('privateSend')
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
  await expect(view.locator('.mp-member-header .mp-member-name')).toHaveText('晚风')
  await expect(view.getByRole('button', { name: '刷新', exact: true })).toBeVisible()
  await expect(view.locator('.mp-member-header .mp-avatar img')).toBeVisible()
  const equalizer = view.locator('.mp-member-equalizer')
  await expect(equalizer).toHaveAttribute('data-playing', 'true')
  await page.evaluate(() => (window as any).partyTest.pause())
  await expect(equalizer).toHaveAttribute('data-playing', 'false')
  await page.evaluate(() => (window as any).partyTest.play())
  await expect(equalizer).toHaveAttribute('data-playing', 'true')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(equalizer.locator('i').first()).toHaveCSS('animation-name', 'none')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
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
  await expect(view.getByRole('heading', { name: '已播歌曲 · 4', exact: true })).toBeVisible()
  await expect(view.locator('[data-current="true"] .mp-track-name')).toHaveText('晚风与海')
  await expect(view.locator('[data-current="true"] .mp-actions')).toHaveText('0 赞')
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

test('an available room can be left from its lobby card without taking over playback', async ({
  page,
  request,
}) => {
  await page.goto('/')
  const existing = page.locator('.mp-lobby-card').filter({
    has: page.getByRole('heading', { name: '继续一起听', exact: true }),
  })
  await expect(existing).toBeVisible()
  const before = await page.evaluate(() => ({ ...(window as any).partyTest.state }))
  expect(await page.evaluate(() => (window as any).partyTest.queue())).toBeUndefined()
  await existing.getByRole('button', { name: '退出当前房间', exact: true }).click()
  await expect(existing).toBeHidden()
  await expect(page.getByRole('button', { name: '匹配房间', exact: true })).toBeEnabled()
  await expect
    .poll(async () => (await (await request.get('/test/state')).json()).joined)
    .toBe(false)
  const result = await (await request.get('/test/state')).json()
  expect(result.calls.filter((call: string) => call.endsWith('/match/exit'))).toHaveLength(1)
  expect(result.operations).toHaveLength(0)
  expect(await page.evaluate(() => ({ ...(window as any).partyTest.state }))).toEqual(before)
  expect(await page.evaluate(() => (window as any).partyTest.queue())).toBeUndefined()
})

test('official matching notification enters a room while pending and leaving preserve playback', async ({
  page,
  request,
}) => {
  await request.post('/test/empty')
  await request.post('/test/match-mode', { data: { value: 'success' } })
  await page.goto('/')
  await page.getByRole('button', { name: '匹配房间', exact: true }).click()
  await expect(page.getByRole('heading', { name: '房间信息', exact: true })).toBeVisible()
  expect((await (await request.get('/test/state')).json()).calls).toContain(
    '/api/listen/together/multi/match/ack',
  )
  await page.getByRole('button', { name: '退出房间', exact: true }).click()
  await expect(page.locator('[data-host-toast]')).toContainText('当前音乐继续播放')
  await expect(page.locator('.mp-panel .mp-notice, .mp-panel > [role=alert]')).toHaveCount(0)
  await request.post('/test/match-mode', { data: { value: 'failure' } })
  await page.getByRole('button', { name: '匹配房间', exact: true }).click()
  await expect(page.locator('[data-host-toast=error]')).toContainText('官方匹配未成功')
  await expect(page.getByRole('button', { name: '取消匹配', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: '匹配房间', exact: true })).toBeEnabled()
})

test('room chat opens at latest and scrolls older history without jumping or prominent activity cards', async ({
  page,
  request,
}) => {
  await request.post('/test/chat-pages')
  await restore(page)
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const history = page.getByLabel('房间聊天记录')
  await expect(history.getByText('聊天消息 79', { exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '加载更早的聊天' })).toHaveCount(0)
  await expect(page.getByText('与网易云官方多人房间互通 · 最多 100 字')).toHaveCount(0)
  expect((await (await request.get('/test/state')).json()).calls).not.toContain('chat:older')
  await expect(history.locator('.mp-activity-body')).toHaveText([
    '小岛 · 为歌曲点赞',
    '小岛来了，带来歌曲 我们俩 - 郭顶',
    '小岛推荐了歌曲：《到时说爱我 - 茜拉》',
  ])
  await expect(history.locator('[data-activity=like] .mp-activity-icon svg')).toHaveCount(1)
  await expect(history.locator('[data-activity=join] .mp-activity-icon svg')).toHaveCount(1)
  await expect(history.locator('[data-activity=recommend] .mp-activity-icon svg')).toHaveCount(1)
  await expect(history.locator('.mp-activity-actor')).toHaveText(['小岛', '小岛', '小岛'])
  await expect(history.locator('.mp-activity-song')).toHaveText(['我们俩', '到时说爱我'])
  await expect(history.locator('.mp-message-secondary .mp-bubble')).toHaveCount(0)
  await expect(history.locator('.mp-bubble').filter({ hasText: '小岛 · 小岛来了' })).toHaveText(
    '小岛 · 小岛来了，带来歌曲 我们俩 - 郭顶 · 我们俩',
  )
  await history.evaluate((node) => {
    node.scrollTop = 5
  })
  await expect
    .poll(async () => (await (await request.get('/test/state')).json()).calls)
    .toContain('chat:older')
  await expect(history.getByText('聊天消息 0', { exact: true })).toBeAttached()
  await expect(history.getByText('聊天消息 30', { exact: true })).toBeInViewport()
  await page.getByRole('tab', { name: '房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await expect(history.getByText('聊天消息 79', { exact: true })).toBeInViewport()
})

test('structured room activities fit the native narrow panel in dark and light themes', async ({
  page,
  request,
}) => {
  await request.post('/test/chat-pages')
  await page.setViewportSize({ width: 360, height: 820 })
  await restore(page)
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const history = page.getByLabel('房间聊天记录')
  await expect(history.locator('.mp-activity-icon svg')).toHaveCount(3)
  for (const theme of ['dark', 'light']) {
    await page.getByRole('combobox', { name: '预览主题' }).selectOption(theme)
    await expect(history.getByText('聊天消息 79', { exact: true })).toBeInViewport()
    expect(await history.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
    await expect(history.locator('.mp-activity-time')).toHaveCount(3)
    await page.locator('#panel').screenshot({ path: `test-results/room-activities-${theme}.png` })
  }
})

test('rematching uses the selected song without changing current playback or recommending it', async ({
  page,
  request,
}) => {
  await restore(page)
  const before = await page.evaluate(() => JSON.stringify((window as any).partyTest.state))
  await page.getByRole('button', { name: '切换歌曲', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择匹配歌曲' })
  await expect(picker).toBeVisible()
  await picker.getByRole('searchbox', { name: '搜索网易云歌曲' }).fill('山海')
  await picker.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(
    picker.getByRole('button', { name: '选择 山海之间 · 晚风', exact: true }),
  ).toBeVisible()
  await page.screenshot({ path: 'test-results/match-song-picker.png' })
  await picker.getByRole('button', { name: '选择 山海之间 · 晚风', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(page.locator('.mp-match-song-summary')).toContainText('山海之间')
  expect(await page.evaluate(() => JSON.stringify((window as any).partyTest.state))).toBe(before)
  expect((await (await request.get('/test/state')).json()).operations).toHaveLength(0)
  expect(await page.evaluate(() => (window as any).partyTest.searchCalls)).toContainEqual({
    provider: 'netease',
    query: '山海',
  })
  await page.getByRole('button', { name: '切换歌曲', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await page.getByRole('button', { name: '切换歌曲', exact: true }).click()
  await page.getByRole('heading', { name: '一起听', exact: true }).click()
  await expect(picker).toBeHidden()
  await page.getByRole('button', { name: '重新匹配', exact: true }).click()
  await expect
    .poll(async () => (await (await request.get('/test/state')).json()).matchSongs)
    .toEqual(['20'])
  await expect(page.getByRole('button', { name: '切换歌曲', exact: true })).toBeDisabled()
  expect(await page.evaluate(() => JSON.stringify((window as any).partyTest.state))).toBe(before)
  await page.getByRole('button', { name: '取消匹配', exact: true }).click()
  await page.setViewportSize({ width: 360, height: 720 })
  await page.getByRole('button', { name: '切换歌曲', exact: true }).click()
  const bounds = await picker.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(360)
  await picker.getByRole('button', { name: '使用当前歌曲 · 晚风与海', exact: true }).click()
  await expect(page.locator('.mp-match-song-summary')).toContainText('晚风与海')
})

test('sidebar pickers open to the left, dismiss on navigation and stay inside narrow windows', async ({
  page,
}) => {
  await restore(page)
  await page.locator('#panel').evaluate((node) => {
    node.style.margin = '24px 16px 24px auto'
    node.style.overflow = 'hidden'
  })
  const panel = page.locator('#panel')
  const expectLeft = async (popup: import('@playwright/test').Locator) => {
    await expect(popup).toBeVisible()
    await expect
      .poll(async () => {
        const a = (await panel.boundingBox())!,
          b = (await popup.boundingBox())!
        return b.x >= 0 && b.x + b.width <= a.x - 8 && b.y >= 0 && b.y + b.height <= 1020
      })
      .toBe(true)
  }
  await page.getByRole('button', { name: '切换歌曲', exact: true }).click()
  const match = page.getByRole('dialog', { name: '选择匹配歌曲' })
  await expectLeft(match)
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await expect(match).toBeHidden()
  const chat = page.locator('.mp-chat-view')
  for (const name of ['Emoji', '颜文字', '表情包', '图片']) {
    await chat.locator(`summary[aria-label="${name}"]`).click()
    const popup = chat.getByRole('dialog', { name, exact: true })
    await expectLeft(popup)
    await page.screenshot({ path: `test-results/side-popup-${name}.png`, animations: 'disabled' })
    await page.keyboard.press('Escape')
    await expect(popup).toBeHidden()
  }
  await chat.locator('summary[aria-label="Emoji"]').click()
  await page.getByRole('tab', { name: '成员', exact: true }).click()
  await expect(chat.getByRole('dialog', { name: 'Emoji', exact: true })).toBeHidden()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await page.setViewportSize({ width: 360, height: 720 })
  await chat.locator('summary[aria-label="Emoji"]').click()
  const popup = chat.getByRole('dialog', { name: 'Emoji', exact: true })
  const bounds = (await popup.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(360)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(720)
  await page.getByRole('heading', { name: '一起听', exact: true }).click()
  await expect(popup).toBeHidden()
})

test('room mentions select members, retain drafts and highlight only the full current nickname', async ({
  page,
  request,
}) => {
  await request.post('/test/room-mentions')
  await restore(page)
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const history = page.getByLabel('房间聊天记录'),
    draft = page.getByRole('textbox', { name: '房间聊天内容' })
  await expect(history.locator('.mp-mention')).toHaveText(['@晚风', '@晚风向海'])
  await expect(history.locator('.mp-mentioned')).toHaveCount(1)
  await expect(history.locator('.mp-mention-badge')).toHaveText('提到了你')
  await draft.fill('你好 @小')
  const list = page.getByRole('listbox', { name: '提及成员' })
  await expect(list.getByRole('option')).toHaveCount(1)
  await page.screenshot({ path: 'test-results/room-mentions.png', animations: 'disabled' })
  await draft.press('Enter')
  await expect(draft).toHaveValue('你好 @小岛 ')
  await expect(list).toBeHidden()
  expect((await (await request.get('/test/state')).json()).calls).not.toContain(
    '/api/middle/im/chatroom/send',
  )
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(history.locator('.mp-bubble').filter({ hasText: '你好 @小岛' })).toHaveText(
    '你好 @小岛',
  )
  await expect(draft).toHaveValue('')
  await history.getByRole('button', { name: '提及 小岛', exact: true }).first().click()
  await expect(draft).toHaveValue('@小岛 ')
  await draft.fill('x'.repeat(98))
  await history.getByRole('button', { name: '提及 小岛', exact: true }).first().click()
  await expect(draft).toHaveValue('x'.repeat(98))
  await draft.fill('@')
  await expect(list).toBeVisible()
  await draft.press('Escape')
  await expect(list).toBeHidden()
  await expect(page.getByRole('button', { name: '提及成员', exact: true })).toHaveCount(0)
  await draft.fill('')
  await draft.fill('@')
  await expect(list).toBeVisible()
  await page.getByRole('tab', { name: '房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await expect(list).toBeHidden()
  await expect(draft).toHaveValue('@')
})

test('room chat wraps long content with avatars and does not duplicate UP actors', async ({
  page,
  request,
}) => {
  await request.post('/test/room-layout')
  await restore(page)
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const history = page.getByLabel('房间聊天记录')
  await expect(history.locator('[data-activity="promote"] .mp-activity-body')).toHaveText(
    'tabidachinokazeUP了《黄金数》',
  )
  const gentleLike = history.locator('[data-activity="like"]').filter({ hasText: 'アプリコット' })
  await expect(gentleLike.locator('.mp-activity-body')).toHaveText(
    'tabidachinokaze浅赞一下《アプリコット》',
  )
  await expect(gentleLike.locator('.mp-activity-actor')).toHaveText('tabidachinokaze')
  await expect(history.locator('.mp-message-primary .mp-message-avatar')).toHaveCount(3)
  await expect(history.locator('.mp-message-primary .mp-message-avatar img')).toHaveCount(3)
  await expect(history.locator('.mp-message-secondary .mp-message-avatar')).toHaveCount(0)
  await expect(history.locator('.mp-message-primary .mp-meta time').first()).toHaveText(
    /^\d{2}-\d{2} \d{2}:\d{2}$/,
  )
  await expect(history.locator('.mp-message.is-mine .mp-meta time')).toHaveText(/^\d{2}:\d{2}$/)
  for (const width of [1100, 360, 280]) {
    await page.setViewportSize({ width, height: 800 })
    await expect
      .poll(() => history.evaluate((node) => node.scrollWidth <= node.clientWidth + 1))
      .toBe(true)
    const outside = await history.evaluate((node) => {
      const bounds = node.getBoundingClientRect()
      return [...node.querySelectorAll('.mp-bubble, .mp-activity-body, .mp-message-avatar')].some(
        (item) => {
          const rect = item.getBoundingClientRect()
          return rect.left < bounds.left - 1 || rect.right > bounds.right + 1
        },
      )
    })
    expect(outside).toBe(false)
  }
  await history.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await page
    .locator('#panel')
    .screenshot({ path: 'test-results/room-chat-wrapped.png', animations: 'disabled' })
})

test('room composer shares emoji tools and sends images to the captured room', async ({
  page,
  request,
}) => {
  await restore(page)
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const chat = page.locator('.mp-chat-view'),
    draft = page.getByRole('textbox', { name: '房间聊天内容' })
  await draft.fill('好听 ')
  await chat.locator('summary[aria-label="Emoji"]').click()
  await chat.getByRole('button', { name: '😊', exact: true }).click()
  await expect(draft).toHaveValue('好听 😊')
  await chat.locator('summary[aria-label="颜文字"]').click()
  await chat.getByRole('button', { name: '(≧▽≦)', exact: true }).click()
  await expect(draft).toHaveValue('好听 😊(≧▽≦)')
  const uploads: any[] = []
  await page.route('**/rpc', async (route) => {
    const payload = route.request().postDataJSON()
    if (payload.name !== 'media') return route.continue()
    uploads.push(payload.args[0])
    await request.post('/test/room-image')
    return route.fulfill({ json: { ok: true, result: { ok: true } } })
  })
  await chat.locator('summary[aria-label="图片"]').click()
  await chat.locator('.mp-image-picker input').setInputFiles({
    name: 'test.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
  })
  await expect(chat.getByRole('img', { name: '待发送图片预览' })).toBeVisible()
  expect(uploads).toHaveLength(0)
  await chat
    .locator('.mp-image-picker')
    .getByRole('button', { name: '发送图片', exact: true })
    .click()
  await expect.poll(() => uploads.length).toBe(1)
  expect(uploads[0].target).toEqual({ kind: 'room', roomId: 'official_room' })
  await expect(chat.locator('.mp-history .mp-message.is-mine .mp-message-content img')).toHaveCount(
    1,
  )
  await expect(chat.locator('.mp-history .mp-message.is-mine .mp-bubble')).toHaveCount(0)
  await expect(draft).toHaveValue('好听 😊(≧▽≦)')
  await expect(chat.getByRole('button', { name: /加载更早|加载更多/ })).toHaveCount(0)
  await chat.locator('summary[aria-label="表情包"]').click()
  await chat.getByRole('button', { name: '开心', exact: true }).click()
  await expect(chat.locator('.mp-history .mp-message.is-mine .mp-message-content img')).toHaveCount(
    2,
  )
  await expect(draft).toHaveValue('好听 😊(≧▽≦)')
})

test('room sticker list loads the next page on scroll without a load-more button or sending', async ({
  page,
  request,
}) => {
  await request.post('/test/sticker-pages')
  await restore(page)
  // Native sidebars are bottom anchored; their maximum height includes player chrome clearance.
  await page.locator('#panel').evaluate((node) => {
    Object.assign(node.style, {
      position: 'fixed',
      top: 'auto',
      bottom: '32px',
      left: 'calc(50% - 160px)',
      margin: '0',
      height: '300px',
      maxHeight: 'calc(100dvh - 88px)',
    })
  })
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const chat = page.locator('.mp-chat-view')
  await chat.locator('summary[aria-label="表情包"]').click()
  const content = chat.locator('.mp-sticker-content:has(.mp-picker-header)')
  await expect(content.locator('[data-sticker-key]')).toHaveCount(24)
  await expect(content.getByRole('button', { name: /加载更多/ })).toHaveCount(0)
  const initialHeight = (await content.boundingBox())!.height
  let resumePage!: () => void
  const pendingPage = new Promise<void>((resolve) => {
    resumePage = resolve
  })
  await page.route('**/rpc', async (route) => {
    const payload = route.request().postDataJSON()
    if (
      payload.name === 'call' &&
      payload.args[0]?.method === 'stickerPage' &&
      payload.args[0]?.args?.cursor
    ) {
      await pendingPage
      const response = await route.fetch()
      const body = await response.json()
      const items = body.result.data.data.emojis
      for (let i = 0; i < 64; i++)
        items.push({ ...items[0], emojiId: String(100 + i), emojiName: `分页表情 ${i}` })
      return route.fulfill({ json: body })
    }
    await route.continue()
  })
  // The first page may fit without a scrollbar; a downward wheel still requests more.
  await content.dispatchEvent('wheel', { deltaY: 200 })
  try {
    await expect(content.getByRole('combobox', { name: '表情分组' })).toBeDisabled()
    await expect(content.getByRole('button', { name: '整理', exact: true })).toBeDisabled()
  } finally {
    resumePage()
  }
  await expect(content.locator('[data-sticker-key]')).toHaveCount(96)
  await expect.poll(async () => (await content.boundingBox())!.height).toBeGreaterThan(340)
  await expect
    .poll(async () => (await content.boundingBox())!.height)
    .toBeGreaterThan(initialHeight)
  const panelBounds = await page.locator('#panel').boundingBox()
  const popupBounds = await content.boundingBox()
  expect(popupBounds!.y).toBeGreaterThanOrEqual(56)
  expect(popupBounds!.y + popupBounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - 32 + 1,
  )
  expect(popupBounds!.height).toBeGreaterThan(panelBounds!.height)
  expect(popupBounds!.height).toBeGreaterThan(850)
  await page.setViewportSize({ width: 1100, height: 560 })
  await expect.poll(async () => (await content.boundingBox())!.height).toBeLessThanOrEqual(472)
  const shortPopup = await content.boundingBox()
  expect(shortPopup!.y).toBeGreaterThanOrEqual(56)
  expect(shortPopup!.y + shortPopup!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - 32 + 1,
  )
  expect(shortPopup!.height).toBeGreaterThan(300)
  expect(await content.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)
  await expect(content.getByRole('combobox', { name: '表情分组' })).toBeEnabled()
  await content.dispatchEvent('wheel', { deltaY: 200 })
  const calls = (await (await request.get('/test/state')).json()).calls
  expect(calls.filter((call: string) => call.startsWith('stickers:'))).toEqual([
    'stickers:first',
    'stickers:next',
  ])
  expect(calls).not.toContain('/api/middle/im/chatroom/send')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const home = page.locator('.mp-private-home')
  await home.locator('summary').filter({ hasText: '表情包' }).click()
  const privateLibrary = home.locator('.mp-sticker-library')
  await expect(privateLibrary.locator('[data-sticker-key]')).toHaveCount(24)
  await privateLibrary.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await privateLibrary.dispatchEvent('wheel', { deltaY: 200 })
  await expect(privateLibrary.locator('[data-sticker-key]')).toHaveCount(96)
  await expect.poll(async () => (await privateLibrary.boundingBox())!.height).toBeGreaterThan(340)
  // Home-mode libraries respect the page's visible area instead of inventing a sidebar baseline.
  const homeBounds = (await home.boundingBox())!
  await expect
    .poll(async () => (await privateLibrary.boundingBox())!.y)
    .toBeGreaterThanOrEqual(Math.max(8, homeBounds.y))
  await expect
    .poll(async () => {
      const bounds = (await privateLibrary.boundingBox())!
      return bounds.y + bounds.height
    })
    .toBeLessThanOrEqual(
      Math.min(page.viewportSize()!.height - 8, homeBounds.y + homeBounds.height),
    )
})

test('promotion counts distinguish zero from missing data and update in queue and member views', async ({
  page,
}) => {
  await restore(page)
  await page.evaluate(() => (window as any).partyTest.openQueue())
  const promoted = page.locator('.native-queue-entry[data-entry-id="200"] [data-action=promote]')
  await expect(promoted.locator('.native-action-count')).toHaveText('2')
  await expect(
    page.locator(
      '.native-queue-entry[data-entry-id="201"] [data-action=promote] .native-action-count',
    ),
  ).toHaveText('0')
  await expect(
    page.locator(
      '.native-queue-entry[data-entry-id="202"] [data-action=promote] .native-action-count',
    ),
  ).toHaveCount(0)
  await promoted.click()
  await expect(promoted.locator('.native-action-count')).toHaveText('3')
  await page.getByRole('tab', { name: '成员', exact: true }).click()
  const members = page.locator('.mp-members-view')
  await members.getByRole('button', { name: '查看 晚风 的推荐', exact: true }).click()
  await expect(members.locator('[data-biz-id="200"] .mp-top-count')).toHaveText('3')
  const up = members
    .locator('[data-biz-id="200"]')
    .getByRole('button', { name: '置顶', exact: true })
  await expect(up).toHaveAttribute('aria-pressed', 'true')
  await expect(
    members.locator('[data-biz-id="201"]').getByRole('button', { name: '置顶', exact: true }),
  ).toHaveCount(0)
  const countBox = (await members.locator('[data-biz-id="200"] .mp-top-count').boundingBox())!
  const buttonBox = (await up.boundingBox())!
  const iconBox = (await up.locator('svg').boundingBox())!
  expect(countBox.x).toBeGreaterThanOrEqual(iconBox.x + iconBox.width)
  expect(countBox.x + countBox.width).toBeLessThanOrEqual(buttonBox.x + buttonBox.width)
  await expect(up.locator('.mp-top-count')).toHaveText('3')
  await expect(members.locator('[data-biz-id="202"] .mp-top-count')).toHaveCount(0)
  await expect(members.locator('[data-biz-id="700"] .mp-actions')).toHaveText('3 赞')
  await members.getByRole('button', { name: '返回', exact: true }).click()
  await members.getByRole('button', { name: '查看 小岛 的推荐', exact: true }).click()
  await expect(members.locator('[data-biz-id="201"] .mp-top-count')).toHaveText('0')
  await expect(
    members.locator('[data-biz-id="201"]').getByRole('button', { name: '置顶', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(
    members.locator('[data-biz-id="201"]').getByRole('button', { name: '删除', exact: true }),
  ).toHaveCount(0)
})

test('notification bridge initializes and closes without exposing credentials or persistent storage', async ({
  page,
}) => {
  await page.goto('/')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.evaluate(async () => {
    const before = Object.keys(localStorage).sort()
    const { createMatchSdk } = await import('/sdk-probe.mjs' as string)
    const calls: unknown[] = []
    const sdk = await createMatchSdk({
      matchTransport: async (...args: unknown[]) => {
        calls.push(args)
        return []
      },
    })
    sdk.onNotification(() => {})
    sdk.onDisconnect(() => {})
    sdk.close()
    sdk.close()
    await new Promise((resolve) => setTimeout(resolve, 100))
    if (JSON.stringify(Object.keys(localStorage).sort()) !== JSON.stringify(before))
      throw new Error('SDK persisted data')
  })
  expect(errors).toEqual([])
})

test('English follows the host locale across room, member, chat and private surfaces', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Preview language' }).selectOption('en')
  await expect(page.getByRole('button', { name: 'Resume current room', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Find a room', exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Let others match into this room' })).toBeVisible()
  await page.getByRole('button', { name: 'Resume current room', exact: true }).click()
  await expect(page.locator('.mp-panel > .mp-header .mp-pill')).toHaveText('3 listening together')
  await page.getByRole('button', { name: 'Change song', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Choose a matching song' })
  await picker.getByRole('searchbox', { name: 'Search NetEase songs' }).fill('山海')
  await picker.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(
    picker.getByRole('button', { name: 'Choose 山海之间 · 晚风', exact: true }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Members', exact: true }).click()
  await page.getByRole('button', { name: 'View recommendations from 晚风', exact: true }).click()
  await expect(page.locator('.mp-members-view')).toContainText('Now playing')
  await expect(page.locator('.mp-members-view')).toContainText('Up next')
  await page.getByRole('tab', { name: 'Chat', exact: true }).click()
  await expect(page.getByText('这首歌适合在海边听。', { exact: true })).toBeVisible()
  await page.getByRole('textbox', { name: 'Room message' }).fill('REJECT')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('You are sending too quickly')
  for (const [label, expected] of [
    ['Kaomoji', '(๑•̀ㅂ•́)و✧'],
    ['Stickers', '开心'],
    ['Image', 'Choose an image'],
  ]) {
    await page.locator(`summary[aria-label="${label}"]:visible`).click()
    if (label === 'Image') await expect(page.getByText(expected, { exact: true })).toBeVisible()
    else if (label === 'Stickers')
      await expect(page.getByRole('button', { name: expected, exact: true })).toBeVisible()
    else await expect(page.locator('.mp-text-picker:visible button').first()).toBeVisible()
    await page.keyboard.press('Escape')
  }
  await expect(page.getByRole('button', { name: 'Mention a member', exact: true })).toHaveCount(0)
  await page.getByRole('textbox', { name: 'Room message' }).fill('@')
  await expect(page.getByRole('option').filter({ hasText: '小岛' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Direct messages', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 unread', exact: true }).click()
  const home = page.locator('.mp-private-home')
  await expect(home.getByRole('heading', { name: 'Direct messages', exact: true })).toBeVisible()
  await expect(home.getByRole('button', { name: 'Refresh messages', exact: true })).toBeVisible()
  await expect(home.getByRole('button', { name: 'Invite to listen', exact: true })).toBeVisible()
  await expect(home.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible()
  await expect(home.getByText('一起听这首吧', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 420, height: 780 })
  await page.screenshot({ path: 'test-results/private-english-narrow.png' })
  expect(await home.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
  expect(
    (await home.getByRole('button', { name: 'Send', exact: true }).boundingBox())!.y,
  ).toBeLessThan(760)
  await page.getByRole('combobox', { name: 'Preview language' }).selectOption('zh-CN')
  await expect(page.getByRole('heading', { name: '私信', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '一起听', exact: true }).click()
  await expect(page.getByRole('tab', { name: '成员', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).partyTest.state.state)).toBe('playing')
  const state = await (await request.get('/test/state')).json()
  expect(state.operations).toHaveLength(0)
  expect(state.calls).not.toContain('privateSend')
})

test('matching progress follows language changes without restarting the match', async ({
  page,
  request,
}) => {
  await request.post('/test/empty')
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Preview language' }).selectOption('en')
  await page.getByRole('button', { name: 'Find a room', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Finding a room…')
  await page.getByRole('combobox', { name: 'Preview language' }).selectOption('zh-CN')
  await expect(page.getByRole('status')).toHaveText('正在寻找房间…')
  expect(await page.evaluate(() => (window as any).partyTest.state.state)).toBe('playing')
  expect((await (await request.get('/test/state')).json()).matchSongs).toHaveLength(1)
  await page.getByRole('button', { name: '取消匹配', exact: true }).click()
  await expect(page.getByRole('button', { name: '匹配房间', exact: true })).toBeVisible()
})

test('private song and album shares keep captions, covers and credits in a single music card', async ({
  page,
  request,
}) => {
  await request.post('/test/private-music')
  await restore(page)
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const history = page.getByLabel('聊天消息')
  await expect(history.locator('.mp-message')).toHaveCount(3)
  await expect(history.locator('.mp-private-music-message')).toHaveCount(3)
  await expect(history.locator('.mp-bubble, .mp-resource')).toHaveCount(0)
  const announcement = history.locator('[data-message-id="server:600"]')
  await expect(announcement.locator('.mp-private-music-caption')).toHaveText(
    '我的最新专辑《Kids》发布了，快来抢先听！',
  )
  await expect(announcement.locator('.mp-private-music-kind')).toHaveText('专辑')
  await expect(announcement.locator('.mp-private-music-title')).toHaveText('Kids')
  await expect(announcement.locator('.mp-private-music-artist')).toHaveText('majiko')
  await expect(announcement.locator('.mp-private-music-cover img')).toBeVisible()
  await expect(history.locator('[data-message-id="server:601"] .mp-private-music-kind')).toHaveText(
    '单曲',
  )
  await expect(
    history.locator('[data-message-id="server:601"] .mp-private-music-artist'),
  ).toHaveText('いよわ')
  await expect(
    history.locator('[data-message-id="server:602"] .mp-message-content > img'),
  ).toHaveCount(0)
  await page.screenshot({ path: 'test-results/private-music-cards.png', animations: 'disabled' })
  for (const locale of ['zh-CN', 'en']) {
    await page.getByRole('combobox', { name: 'Preview language' }).selectOption(locale)
    await page.getByRole('button', { name: '小岛', exact: true }).click()
    await expect(page.locator('.mp-private-music-kind')).toHaveText(
      locale === 'en' ? ['Album', 'Song', 'Album'] : ['专辑', '单曲', '专辑'],
    )
    await page.setViewportSize({ width: 420, height: 780 })
    expect(
      await page
        .locator('.mp-private-home')
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true)
    expect(
      await page
        .locator('.mp-history:visible')
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
    ).toBe(true)
  }
  await page.screenshot({ path: 'test-results/private-music-cards-narrow.png' })
})

test('long matching titles and English room tools fit the sidebar without clipping controls', async ({
  page,
  request,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await restore(page)
  const song = {
    id: '1',
    source: 'netease',
    ref: '1',
    title: 'オヌオイ・ハマンはもういらない'.repeat(12),
    artist: 'Tomohiko Togashi / Yana'.repeat(12),
  }
  await page.evaluate((song) => (window as any).partyTest.setCurrentSong(song), song)
  for (const locale of ['zh-CN', 'en']) {
    await page.getByRole('combobox', { name: 'Preview language' }).selectOption(locale)
    await page.getByRole('tab', { name: locale === 'en' ? 'Room' : '房间', exact: true }).click()
    const change = page.getByRole('button', {
      name: locale === 'en' ? 'Change song' : '切换歌曲',
      exact: true,
    })
    await change.click()
    const picker = page.getByRole('dialog', {
      name: locale === 'en' ? 'Choose a matching song' : '选择匹配歌曲',
    })
    await picker.locator('.mp-match-current').click()
    await expect(page.locator('.mp-match-song-summary strong')).toHaveText(song.title)
    for (const width of [320, 280]) {
      await page.locator('#panel').evaluate((node, width) => {
        node.style.width = `${width}px`
      }, width)
      const card = page.locator('.mp-lobby-card').filter({ has: change })
      const a = (await card.boundingBox())!,
        b = (await change.boundingBox())!
      expect(b.x + b.width).toBeLessThanOrEqual(a.x + a.width - 8)
      expect(await card.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
      await page.screenshot({ path: `test-results/matching-${locale}-${width}.png` })
    }
    await page.getByRole('tab', { name: locale === 'en' ? 'Chat' : '聊天', exact: true }).click()
    const chat = page.locator('.mp-chat-view'),
      tools = chat.locator('.mp-room-composer-tools')
    expect(errors).toEqual([])
    await expect(chat.getByRole('textbox')).toBeVisible()
    await expect(chat.getByRole('textbox')).toHaveAttribute('placeholder', /@/)
    await expect(chat.locator('.mp-mention-trigger')).toHaveCount(0)
    const controls = await tools.locator('summary, button[type=submit]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }),
    )
    expect(controls).toHaveLength(5)
    expect(controls.every((r) => r.width > 0 && r.height > 0)).toBe(true)
    expect(new Set(controls.map((r) => r.y)).size).toBe(1)
    expect(await tools.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: `test-results/composer-${locale}.png`, animations: 'disabled' })
  }
  expect((await (await request.get('/test/state')).json()).operations).toHaveLength(0)
})

test('private activity and artist cards stay unified and open the correct destination', async ({
  page,
  request,
}) => {
  await request.post('/test/private-resources')
  await restore(page)
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const history = page.locator('.mp-private-home .mp-history')
  await expect(history.locator('.mp-private-resource-message')).toHaveCount(6)
  await expect(
    history.locator('.mp-message-content > .mp-bubble, .mp-message-content > .mp-resource'),
  ).toHaveCount(0)
  await expect(history.locator('.mp-private-music-cover img')).toHaveCount(6)
  const album = history.locator('[data-message-id="server:801"]')
  await expect(album.locator('.mp-private-music-kind')).toHaveText('专辑')
  await expect(album.locator('.mp-private-music-artist')).toHaveText('示例歌手')
  const card = history.locator('[data-message-id="server:800"]')
  await card.getByRole('button', { name: '打开 打开音乐活动', exact: true }).click()
  expect(await page.evaluate(() => (window as any).partyTest.externalUrls)).toEqual([
    'https://music.163.com/g/example-activity?id=100',
  ])
  await album.getByRole('button', { name: '查看专辑 海边专辑', exact: true }).click()
  expect(await page.evaluate(() => (window as any).partyTest.openedAlbums)).toEqual([
    { provider: 'netease', id: '700' },
  ])
  const sharedSong = history.getByRole('button', { name: '试听或推荐 海边单曲', exact: true }),
    choice = page.getByRole('dialog', { name: '歌曲操作', exact: true })
  await sharedSong.click()
  await expect(choice).toBeVisible()
  await expect(choice.locator('.mp-private-song-choice-info strong')).toHaveText('海边单曲')
  await page.screenshot({ path: test.info().outputPath('private-song-choice.png') })
  await choice.getByRole('button', { name: '取消', exact: true }).click()
  await expect(choice).toBeHidden()
  expect((await (await request.get('/test/state')).json()).operations).toHaveLength(0)
  expect(await page.evaluate(() => (window as any).partyTest.auditionedSongs)).toHaveLength(0)
  await sharedSong.click()
  await page.keyboard.press('Escape')
  await expect(choice).toBeHidden()
  await sharedSong.click()
  await page.mouse.click(6, 6)
  await expect(choice).toBeHidden()
  await sharedSong.click()
  await choice.getByRole('button', { name: '试听', exact: true }).click()
  await expect(choice).toBeHidden()
  await expect.poll(() => page.evaluate(() => (window as any).partyTest.state.song.id)).toBe('701')
  expect(await page.evaluate(() => (window as any).partyTest.auditionedSongs)).toEqual(['701'])
  expect(await page.evaluate(() => (window as any).partyTest.playedSongs)).toHaveLength(0)
  expect((await (await request.get('/test/state')).json()).operations).toHaveLength(0)
  expect((await (await request.get('/test/state')).json()).current).toBe('1')
  await page.evaluate(() => (window as any).partyTest.openQueue())
  await expect(
    page.locator('#native-queue').getByRole('button', { name: '返回房间', exact: true }),
  ).toHaveCount(0)
  await page.evaluate(() => {
    const queue = (window as any).partyTest.queue()
    ;(window as any).partyTest.intent({
      type: 'queue-action',
      entryId: null,
      actionId: queue.stopAction.id,
    })
  })
  await expect.poll(() => page.evaluate(() => (window as any).partyTest.state.song.id)).toBe('1')
  expect((await (await request.get('/test/state')).json()).operations).toHaveLength(0)
  await sharedSong.click()
  await choice.getByRole('button', { name: '推歌', exact: true }).click()
  await expect
    .poll(
      async () =>
        (await (await request.get('/test/state')).json()).operations.filter(
          (o: any) => o.operate === 1,
        ).length,
    )
    .toBe(1)
  expect(await page.evaluate(() => (window as any).partyTest.playedSongs)).toHaveLength(0)
  await history.getByRole('button', { name: '在网易云打开 未来单曲', exact: true }).click()
  expect((await page.evaluate(() => (window as any).partyTest.externalUrls))[1]).toContain(
    'component=rn-appointment',
  )
  await expect(history.locator('[data-message-id="server:805"] button')).toHaveCount(0)
  await page.getByRole('button', { name: '一起听', exact: true }).click()
  await page.getByRole('button', { name: '退出房间', exact: true }).click()
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛', exact: true }).click()
  await history.getByRole('button', { name: '播放 海边单曲', exact: true }).click()
  expect(await page.evaluate(() => (window as any).partyTest.playedSongs)).toEqual(['701'])
  await page.screenshot({
    path: 'test-results/private-resources-desktop.png',
    animations: 'disabled',
  })
  await page.setViewportSize({ width: 420, height: 780 })
  await page.getByRole('combobox', { name: 'Preview language' }).selectOption('en')
  await page.getByRole('button', { name: '小岛', exact: true }).click()
  await expect(
    history.getByRole('button', { name: 'View album 海边专辑', exact: true }),
  ).toBeVisible()
  expect(await history.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true)
  await page.screenshot({
    path: 'test-results/private-resources-narrow.png',
    animations: 'disabled',
  })
})
