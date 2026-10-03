import { expect, test, type Locator, type Page } from '@playwright/test'

// tests/browser/danmaku-preview.spec.ts
const previewSelector = '.mp-danmaku-host[data-preview="true"]'
async function openSettings(page: Page) {
  await page.locator('.mp-chat-settings summary[aria-label="弹幕设置"]').click()
  return page.locator('.mp-chat-settings-popover[data-settings="danmaku"]')
}
async function slider(popup: Locator, name: string, value: number) {
  await popup.getByRole('slider', { name, exact: true }).evaluate((node, value) => {
    ;(node as HTMLInputElement).value = String(value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}
test.beforeEach(async ({ page, request }) => {
  await request.get('/test/reset')
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
})

test('settings preview works with danmaku off, updates live and cleans up on dismissal', async ({
  page,
  request,
}) => {
  const enabled = page.getByRole('switch', { name: '启用弹幕' }),
    preview = page.locator(previewSelector),
    comments = preview.locator('.mp-danmaku-message'),
    before = (await (await request.get('/test/state')).json()).messages.length
  await expect(enabled).not.toBeChecked()
  const popup = await openSettings(page)
  await expect(comments.first()).toBeAttached()
  await expect(comments.first()).toContainText('预览')
  await popup.getByRole('button', { name: '顶部', exact: true }).click()
  await slider(popup, '字号', 150)
  await slider(popup, '不透明度', 40)
  await expect(preview.locator('.mp-danmaku')).toHaveCSS('opacity', '0.4')
  await expect(preview.locator('.mp-danmaku')).toHaveAttribute('data-mode', 'top')
  await expect(preview.locator('.mp-danmaku-message[data-kind="text"]')).toHaveCSS(
    'font-size',
    '25.5px',
  )
  await popup.getByRole('button', { name: '文字消息', exact: true }).click()
  await popup.getByRole('button', { name: '房间动态', exact: true }).click()
  await expect(comments).toHaveCount(1)
  await expect(comments.locator('img')).toBeVisible()
  expect(
    await comments.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBeGreaterThan(0)
  await popup.getByRole('button', { name: '图片与表情', exact: true }).click()
  await expect(comments).toHaveCount(0)
  await popup.getByRole('button', { name: '文字消息', exact: true }).click()
  await expect(comments).toHaveCount(1)
  await popup.locator('.mp-chat-settings-advanced > summary').click()
  await popup.getByRole('combobox', { name: '字体' }).click()
  await page.keyboard.press('Escape')
  await expect(popup).toBeVisible()
  await expect(comments).toHaveCount(1)
  await page.screenshot({ path: test.info().outputPath('danmaku-preview.png') })
  await page.keyboard.press('Escape')
  await expect(comments).toHaveCount(0)
  await expect(enabled).not.toBeChecked()
  expect((await (await request.get('/test/state')).json()).messages.length).toBe(before)
  await openSettings(page)
  await expect(comments).toHaveCount(1)
  await page.getByRole('tab', { name: '房间', exact: true }).click()
  await expect(comments).toHaveCount(0)
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await openSettings(page)
  await expect(comments).toHaveCount(1)
  await page.evaluate(() => (window as any).partyTest.dispose())
  await expect(page.locator(previewSelector)).toHaveCount(0)
})

test('closing settings removes preview comments while retaining live room comments', async ({
  page,
  request,
}) => {
  await page.getByRole('switch', { name: '启用弹幕' }).check()
  await request.post('/test/room-mentions')
  const live = page.locator('.mp-danmaku-host:not([data-preview="true"]) .mp-danmaku-message'),
    preview = page.locator(`${previewSelector} .mp-danmaku-message`)
  await expect(live).toHaveCount(2, { timeout: 10000 })
  await openSettings(page)
  await expect(preview.first()).toBeAttached()
  await expect(live).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(live).toHaveCount(2)
  await expect(page.locator('.mp-history')).not.toContainText('弹幕预览')
})
