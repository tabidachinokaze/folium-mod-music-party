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
  await page.getByRole('button', { name: '提及成员', exact: true }).click()
  await expect(list).toBeVisible()
  await page.getByRole('tab', { name: '房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await expect(list).toBeHidden()
  await expect(draft).toHaveValue('@')
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
  await chat.locator('summary').filter({ hasText: 'Emoji' }).click()
  await chat.getByRole('button', { name: '😊', exact: true }).click()
  await expect(draft).toHaveValue('好听 😊')
  await chat.locator('summary').filter({ hasText: '颜文字' }).click()
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
  await chat.locator('summary').filter({ hasText: '图片' }).click()
  await chat.locator('.mp-image-picker input').setInputFiles({
    name: 'test.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
  })
  await expect.poll(() => uploads.length).toBe(1)
  expect(uploads[0].target).toEqual({ kind: 'room', roomId: 'official_room' })
  await expect(chat.locator('.mp-history .mp-message.is-mine img')).toHaveCount(1)
  await expect(chat.locator('.mp-history .mp-message.is-mine .mp-bubble')).toHaveCount(0)
  await expect(draft).toHaveValue('好听 😊(≧▽≦)')
  await expect(chat.getByRole('button', { name: /加载更早|加载更多/ })).toHaveCount(0)
  await chat.locator('summary').filter({ hasText: '表情包' }).click()
  await chat.getByRole('button', { name: '开心', exact: true }).click()
  await expect(chat.locator('.mp-history .mp-message.is-mine img')).toHaveCount(2)
  await expect(draft).toHaveValue('好听 😊(≧▽≦)')
})

test('room sticker list loads the next page on scroll without a load-more button or sending', async ({
  page,
  request,
}) => {
  await request.post('/test/sticker-pages')
  await restore(page)
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const chat = page.locator('.mp-chat-view')
  await chat.locator('summary').filter({ hasText: '表情包' }).click()
  const content = chat.locator('.mp-sticker-content:has(.mp-picker-header)')
  await expect(content.locator('[data-sticker-key]')).toHaveCount(24)
  await expect(content.getByRole('button', { name: /加载更多/ })).toHaveCount(0)
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
    )
      await pendingPage
    await route.continue()
  })
  await content.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  try {
    await expect(content.getByRole('combobox', { name: '表情分组' })).toBeDisabled()
    await expect(content.getByRole('button', { name: '整理', exact: true })).toBeDisabled()
  } finally {
    resumePage()
  }
  await expect(content.locator('[data-sticker-key]')).toHaveCount(32)
  await expect(content.getByRole('combobox', { name: '表情分组' })).toBeEnabled()
  await content.dispatchEvent('wheel', { deltaY: 200 })
  const calls = (await (await request.get('/test/state')).json()).calls
  expect(calls.filter((call: string) => call.startsWith('stickers:'))).toEqual([
    'stickers:first',
    'stickers:next',
  ])
  expect(calls).not.toContain('/api/middle/im/chatroom/send')
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
  await expect(members.locator('[data-biz-id="202"] .mp-top-count')).toHaveCount(0)
  await expect(members.locator('[data-biz-id="700"] .mp-actions')).toHaveText('置顶 4 · 3 赞')
  await members.getByRole('button', { name: '返回', exact: true }).click()
  await members.getByRole('button', { name: '查看 小岛 的推荐', exact: true }).click()
  await expect(members.locator('[data-biz-id="201"] .mp-top-count')).toHaveText('0')
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
