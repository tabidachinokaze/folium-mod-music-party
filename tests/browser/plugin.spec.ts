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
  await page.getByRole('button', { name: '连接网易云账号', exact: true }).click()
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await expect(page.getByText('3 人一起听', { exact: true })).toBeVisible()
}
test('full queue, own deletion, official next and local cleanup', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await restore(page)
  await page.screenshot({ path: 'test-results/room.png', fullPage: true })
  await page.getByRole('button', { name: '播放队列', exact: true }).click()
  await expect(page.locator('.native-queue-entry')).toHaveCount(10)
  await expect(page.getByRole('button', { name: '删除我的推荐', exact: true })).toHaveCount(5)
  await page.getByRole('button', { name: '删除我的推荐', exact: true }).first().click()
  await expect(page.locator('.native-queue-entry')).toHaveCount(9)
  await page.getByRole('tab', { name: '房间', exact: true }).click()
  await page.getByRole('button', { name: '请求下一首' }).click()
  await expect(page.getByRole('heading', { name: '下一站 · 2' })).toBeVisible()
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
  await page.getByRole('button', { name: '连接网易云账号', exact: true }).click()
  await expect(page.getByRole('button', { name: '恢复当前房间', exact: true })).not.toBeVisible()
  expect((await (await request.get('/test/state')).json()).calls).toEqual([])
})
