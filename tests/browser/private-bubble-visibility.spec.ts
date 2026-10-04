import { expect, test } from '@playwright/test'
import { privateNotificationFixture } from './private-notification-fixture'

// tests/browser/private-bubble-visibility.spec.ts
test.beforeEach(async ({ page, request }) => {
  await request.get('/test/reset')
  await page.route('https://p1.music.126.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"/>',
    }),
  )
})

test('private avatars follow player chrome while a new private notification can still open a reply', async ({
  page,
}) => {
  const notices = await privateNotificationFixture(page)
  await page.goto('/')
  await expect.poll(() => notices.polls.length).toBeGreaterThan(0)
  notices.push('保留的未读消息')
  const rail = page.locator('.mp-private-bubble-rail')
  await expect(rail).toHaveAttribute('data-visible', 'true')
  await page.getByRole('button', { name: '关闭通知', exact: true }).click()
  await page.mouse.move(600, 700)
  await page.evaluate(() =>
    (window as any).partyTest.setStageDisplay({ isPlayerChromeHidden: true }),
  )
  await expect(rail).toHaveAttribute('data-visible', 'false')
  await expect(rail).toBeHidden()
  await expect(rail).toHaveAttribute('inert', '')
  notices.push('控件隐藏时的新通知')
  const reply = page.getByRole('button', { name: '回复 小岛' })
  await expect(reply).toBeVisible()
  await expect(rail).toBeHidden()
  await reply.click()
  const dialog = page.getByRole('dialog', { name: '与小岛对话' })
  await expect(dialog).toHaveAttribute('data-visible', 'true')
  await expect(dialog.getByRole('textbox', { name: '私信内容' })).toBeFocused()
  await expect(dialog.getByText('控件隐藏时的新通知', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '收起对话', exact: true }).click()
  await page.getByRole('combobox', { name: '模拟音乐来源' }).focus()
  await page.mouse.move(600, 700)
  await expect(rail).toHaveAttribute('data-visible', 'false')
  await page.evaluate(() =>
    (window as any).partyTest.setStageDisplay({ isPlayerChromeHidden: false }),
  )
  await expect(rail).toHaveAttribute('data-visible', 'true')
  await expect(rail).toBeVisible()
})

test('an active conversation and its side popup stay usable until focus leaves, preserving the draft', async ({
  page,
}) => {
  const notices = await privateNotificationFixture(page)
  await page.goto('/')
  await expect.poll(() => notices.polls.length).toBeGreaterThan(0)
  notices.push('打开对话并保留草稿')
  await page.getByRole('button', { name: '回复 小岛' }).click()
  const dialog = page.getByRole('dialog', { name: '与小岛对话', includeHidden: true }),
    draft = dialog.getByRole('textbox', { name: '私信内容', includeHidden: true })
  await draft.fill('尚未发送的草稿')
  await page.mouse.move(600, 700)
  await page.evaluate(() =>
    (window as any).partyTest.setStageDisplay({ isPlayerChromeHidden: true }),
  )
  await expect(dialog).toHaveAttribute('data-visible', 'true')
  await dialog
    .locator('summary')
    .filter({ hasText: /^Emoji$/ })
    .click()
  const popup = dialog.getByRole('dialog', { name: 'Emoji', exact: true })
  await expect(popup).toBeVisible()
  await expect(dialog).toHaveAttribute('data-visible', 'true')
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
  await page.getByRole('combobox', { name: '模拟音乐来源' }).focus()
  await page.mouse.move(600, 700)
  await expect(dialog).toHaveAttribute('data-visible', 'false')
  await expect(dialog).toBeHidden()
  await expect(draft).toHaveValue('尚未发送的草稿')
  await page.evaluate(() =>
    (window as any).partyTest.setStageDisplay({ isPlayerChromeHidden: false }),
  )
  await expect(dialog).toBeVisible()
  await expect(draft).toHaveValue('尚未发送的草稿')
})
