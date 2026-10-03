import { expect, test, type Page } from '@playwright/test'

// tests/browser/chat-presentation.spec.ts
async function enterChat(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
}
async function settings(page: Page) {
  await page.locator('.mp-chat-settings > summary').click()
  return page.locator('.mp-chat-settings-popover')
}
async function floating(page: Page, seconds = 5) {
  const popup = await settings(page)
  await popup.getByRole('combobox', { name: '聊天位置' }).selectOption('bottom-left')
  await popup.getByRole('spinbutton', { name: '新消息显示时长' }).fill(String(seconds))
  await popup.getByRole('spinbutton', { name: '新消息显示时长' }).press('Tab')
  await page.keyboard.press('Escape')
  return page.locator('.mp-floating-chat')
}
test.beforeEach(async ({ page, request }) => {
  await request.get('/test/reset')
  await page.setViewportSize({ width: 1100, height: 850 })
  await page.route('https://p1.music.126.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#b4dabc"/></svg>',
    }),
  )
})

test('chat moves without losing its draft, avoids bottom controls, and opens tools to the right', async ({
  page,
}) => {
  await enterChat(page)
  await page.getByRole('textbox', { name: '房间聊天内容' }).fill('保留草稿 😊')
  await page.evaluate(() => {
    const card = document.createElement('div')
    card.dataset.toastCard = ''
    card.style.cssText =
      'position:fixed;left:24px;bottom:32px;width:260px;height:70px;background:#333'
    document.body.append(card)
  })
  const chat = await floating(page)
  await expect(chat).toHaveAttribute('data-visible', 'true')
  await expect(chat.getByRole('textbox', { name: '房间聊天内容' })).toHaveValue('保留草稿 😊')
  await expect
    .poll(async () => {
      const box = (await chat.boundingBox())!,
        card = (await page.locator('[data-toast-card]').boundingBox())!
      return card.y - box.y - box.height
    })
    .toBeGreaterThanOrEqual(10)
  await chat.locator('summary[aria-label="Emoji"]').click()
  const emoji = chat.getByRole('dialog', { name: 'Emoji', exact: true })
  await expect(emoji).toBeVisible()
  expect((await emoji.boundingBox())!.x).toBeGreaterThan(
    (await chat.boundingBox())!.x + (await chat.boundingBox())!.width,
  )
  await page.keyboard.press('Escape')
  await page.evaluate(() => (window as any).partyTest.remountStage())
  await expect(chat.getByRole('textbox', { name: '房间聊天内容' })).toHaveValue('保留草稿 😊')
  const popup = await settings(page)
  await popup.getByRole('combobox', { name: '聊天位置' }).selectOption('panel')
  await page.keyboard.press('Escape')
  await expect(page.locator('#panel').getByRole('textbox', { name: '房间聊天内容' })).toHaveValue(
    '保留草稿 😊',
  )
  await expect(page.locator('.mp-chat-view')).toHaveCount(1)
})

test('hidden chat previews only new messages for the chosen duration and follows host visibility', async ({
  page,
  request,
}) => {
  await enterChat(page)
  const chat = await floating(page, 1)
  await page.mouse.move(1080, 20)
  await page.evaluate(() =>
    (window as any).partyTest.setStageDisplay({ isPlayerChromeHidden: true }),
  )
  await expect(chat).toHaveAttribute('data-visible', 'false')
  await expect(page.locator('.mp-chat-peek')).toHaveCount(0)
  await request.post('/test/room-mentions')
  await expect(page.locator('.mp-chat-peek').first()).toBeVisible({ timeout: 10000 })
  await expect(page.locator('.mp-chat-peeks')).toContainText('@晚风 这首歌很适合你')
  await expect(chat).toHaveAttribute('data-visible', 'false')
  await expect(page.locator('.mp-chat-peek')).toHaveCount(0, { timeout: 4000 })
  await page.evaluate(() =>
    (window as any).partyTest.setStageDisplay({ isPlayerChromeHidden: false }),
  )
  await expect(chat).toHaveAttribute('data-visible', 'true')
  await page.evaluate(() => (window as any).partyTest.setStageDisplay({ showText: false }))
  await expect(chat).not.toBeVisible()
  await page.evaluate(() => (window as any).partyTest.setStageDisplay({ showText: true }))
  await expect(chat).toHaveAttribute('data-visible', 'true')
  await page.reload()
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await expect(page.locator('.mp-floating-chat')).toHaveAttribute('data-visible', 'true')
})

test('danmaku renders new text, media and activity without replaying history, and cleans up when disabled', async ({
  page,
  request,
}) => {
  await enterChat(page)
  const popup = await settings(page)
  await popup.getByRole('switch', { name: '启用弹幕' }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('.mp-danmaku-message')).toHaveCount(0)
  await request.post('/test/room-layout')
  await request.post('/test/room-image')
  const draft = page.getByRole('textbox', { name: '房间聊天内容' })
  await draft.fill('弹幕测试 😊 (｡･ω･｡)')
  await draft.press('Control+Enter')
  await expect(page.locator('.mp-danmaku-message').first()).toBeAttached({ timeout: 10000 })
  await expect(page.locator('.mp-danmaku-message img').first()).toBeAttached({ timeout: 10000 })
  await expect
    .poll(async () => (await page.locator('.mp-danmaku-message').first().boundingBox())?.x ?? 1100)
    .toBeLessThan(850)
  await page.screenshot({ path: test.info().outputPath('danmaku.png') })
  await page.evaluate(() => (window as any).partyTest.setStageDisplay({ showText: false }))
  await expect(page.locator('.mp-danmaku-message')).toHaveCount(0)
  await page.evaluate(() => (window as any).partyTest.setStageDisplay({ showText: true }))
  await expect(page.locator('.mp-danmaku-message')).toHaveCount(0)
  const again = await settings(page)
  await again.getByRole('switch', { name: '启用弹幕' }).uncheck()
  await page.keyboard.press('Escape')
  await expect(page.locator('.mp-danmaku-message')).toHaveCount(0)
  await page.evaluate(() => (window as any).partyTest.dispose())
  await expect(page.locator('.mp-chat-presentation')).toHaveCount(0)
})
