import { expect, test, type Page } from '@playwright/test'

// tests/browser/chat-presentation.spec.ts
async function enterChat(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
}
async function settings(page: Page, kind: 'chat' | 'danmaku' = 'chat') {
  await page
    .locator(`.mp-chat-settings summary[aria-label="${kind === 'chat' ? '聊天显示' : '弹幕设置'}"]`)
    .click()
  return page.locator(`.mp-chat-settings-popover[data-settings="${kind}"]`)
}
async function choose(container: import('@playwright/test').Locator, name: string, option: string) {
  await container.getByRole('combobox', { name, exact: true }).click()
  await container
    .getByRole('listbox', { name, exact: true })
    .getByRole('option', { name: option, exact: true })
    .click()
}
async function floating(page: Page, seconds = 5) {
  const popup = await settings(page)
  await choose(popup, '聊天位置', '左下角')
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
  await expect(chat.locator('.mp-chat-view')).toHaveAttribute('data-live-composer', 'collapsed')
  await expect(chat.locator('.mp-live-compose-open')).toContainText('保留草稿 😊')
  await chat.locator('.mp-live-compose-open').click()
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
  await expect(chat.locator('textarea')).toHaveValue('保留草稿 😊')
  const popup = await settings(page)
  await choose(popup, '聊天位置', '面板内')
  await page.keyboard.press('Escape')
  await expect(page.locator('#panel').getByRole('textbox', { name: '房间聊天内容' })).toHaveValue(
    '保留草稿 😊',
  )
  await expect(page.locator('.mp-chat-view')).toHaveCount(1)
})

test('floating live chat keeps a compact message flow and expands its composer on demand', async ({
  page,
  request,
}) => {
  await enterChat(page)
  const chat = await floating(page),
    view = chat.locator('.mp-chat-view'),
    draft = chat.getByRole('textbox', { name: '房间聊天内容' })
  await expect(view).toHaveAttribute('data-live-composer', 'collapsed')
  await expect(draft).toBeHidden()
  await expect(chat.locator('.mp-live-compose-open')).toHaveText('说点什么…')
  await chat.locator('.mp-live-compose-open').click()
  await draft.fill('第一行')
  await draft.press('Enter')
  await draft.pressSequentially('第二行')
  await expect(draft).toHaveValue('第一行\n第二行')
  await page.mouse.click(700, 20)
  await expect(view).toHaveAttribute('data-live-composer', 'collapsed')
  await expect(chat.locator('.mp-live-compose-open')).toHaveText('第一行 第二行')
  await chat.locator('.mp-live-compose-emoji').click()
  await expect(chat.getByRole('dialog', { name: 'Emoji', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(draft).toHaveValue('第一行\n第二行')
  await request.post('/test/room-mentions')
  await draft.press('Control+Enter')
  await expect(view).toHaveAttribute('data-live-composer', 'collapsed')
  await expect(chat.locator('.mp-live-compose-open')).toHaveText('说点什么…')
  await expect(chat.locator('.mp-history')).toContainText('第一行\n第二行')
  await expect(chat.locator('.mp-history')).toContainText('@晚风 这首歌很适合你')
  const bubble = chat.locator('.mp-message:not(.mp-message-secondary) .mp-bubble').last()
  await expect(bubble).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(chat.locator('.mp-message-avatar').first()).toBeHidden()
  await expect.poll(() => chat.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  await page.screenshot({ path: test.info().outputPath('live-chat.png') })
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

test('language changes preserve IME input and wait for an outstanding send to finish', async ({
  page,
}) => {
  await enterChat(page)
  const chat = await floating(page),
    draft = chat.locator('textarea'),
    language = page.getByRole('combobox', { name: 'Preview language' })
  await chat.locator('.mp-live-compose-open').click()
  await draft.fill('组合输入保留')
  await draft.evaluate((node) => {
    node.dataset.compositionProbe = 'same-node'
    node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  })
  await language.selectOption('en')
  await expect(draft).toHaveAttribute('data-composition-probe', 'same-node')
  await draft.dispatchEvent('compositionend')
  await expect(draft).toHaveAttribute('aria-label', 'Room message')
  await expect(draft).toHaveValue('组合输入保留')
  let release!: () => void,
    sending = false
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/rpc', async (route) => {
    if (route.request().postDataJSON()?.args?.[0]?.method === 'multiChatSend') {
      sending = true
      await pending
    }
    await route.continue()
  })
  try {
    if (!(await draft.isVisible())) await chat.locator('.mp-live-compose-open').click()
    await draft.fill('发送中切换语言')
    await draft.press('Control+Enter')
    await expect.poll(() => sending).toBe(true)
    await language.selectOption('zh-CN')
    await expect(draft).toHaveAttribute('aria-label', 'Room message')
    release()
    await expect(draft).toHaveAttribute('aria-label', '房间聊天内容')
    await expect(draft).toHaveValue('')
    await expect(chat.locator('.mp-live-compose-open')).toHaveText('说点什么…')
    await expect(chat.locator('.mp-history')).toContainText('发送中切换语言')
  } finally {
    release()
  }
})

test('danmaku renders new text, media and activity without replaying history, and cleans up when disabled', async ({
  page,
  request,
}) => {
  await enterChat(page)
  await page.getByRole('switch', { name: '启用弹幕' }).check()
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
  await page.getByRole('switch', { name: '启用弹幕' }).uncheck()
  await expect(page.locator('.mp-danmaku-message')).toHaveCount(0)
  await page.evaluate(() => (window as any).partyTest.dispose())
  await expect(page.locator('.mp-chat-presentation')).toHaveCount(0)
})

test('danmaku settings persist, filter actual message types, and reset without moving chat', async ({
  page,
  request,
}) => {
  await enterChat(page)
  await page.getByRole('switch', { name: '启用弹幕' }).check()
  const popup = await settings(page, 'danmaku')
  await popup
    .getByRole('group', { name: '显示模式' })
    .getByRole('button', { name: '底部', exact: true })
    .click()
  for (const [name, value] of [
    ['显示区域', '25'],
    ['不透明度', '40'],
    ['字号', '125'],
    ['速度', '70'],
  ])
    await popup.getByRole('slider', { name, exact: true }).evaluate((node, value) => {
      ;(node as HTMLInputElement).value = value
      node.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
  await popup.getByRole('button', { name: '文字消息', exact: true }).click()
  await popup.getByRole('button', { name: '图片与表情', exact: true }).click()
  await popup.locator('.mp-chat-settings-advanced > summary').click()
  await choose(popup, '字体', '宋体')
  await popup.getByRole('switch', { name: '粗体', exact: true }).uncheck()
  await popup.getByRole('button', { name: '描边', exact: true }).click()
  await expect(popup.getByRole('button', { name: '描边', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  const box = (await popup.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(8)
  expect(box.y + box.height).toBeLessThanOrEqual(842)
  await page.screenshot({ path: test.info().outputPath('danmaku-settings.png') })
  await page.keyboard.press('Escape')
  await request.post('/test/room-layout')
  await request.post('/test/room-image')
  const draft = page.getByRole('textbox', { name: '房间聊天内容' })
  await draft.fill('这条只显示在聊天列表')
  await draft.press('Control+Enter')
  await expect(page.locator('.mp-danmaku-message[data-kind="activity"]').first()).toBeVisible({
    timeout: 10000,
  })
  await expect(page.locator('.mp-danmaku-message:not([data-kind="activity"])')).toHaveCount(0)
  await expect(page.locator('.mp-history')).toContainText('这条只显示在聊天列表')
  const messageBox = (await page.locator('.mp-danmaku-message').first().boundingBox())!
  expect(messageBox.y).toBeGreaterThan(600)
  await page.reload()
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await settings(page, 'danmaku')
  await expect(popup.getByRole('slider', { name: '不透明度', exact: true })).toHaveValue('40')
  await expect(popup.getByRole('button', { name: '底部', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(popup.getByRole('button', { name: '文字消息', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  const chatSettings = await settings(page)
  await choose(chatSettings, '聊天位置', '左下角')
  await chatSettings.getByRole('spinbutton', { name: '新消息显示时长' }).fill('9')
  await chatSettings.getByRole('spinbutton', { name: '新消息显示时长' }).press('Tab')
  await settings(page, 'danmaku')
  await popup.getByRole('button', { name: '恢复弹幕默认设置', exact: true }).click()
  await expect(page.getByRole('switch', { name: '启用弹幕' })).toBeChecked()
  await expect(popup.getByRole('slider', { name: '不透明度', exact: true })).toHaveValue('85')
  await expect(popup.getByRole('button', { name: '滚动', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(popup.getByRole('button', { name: '文字消息', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await settings(page)
  await expect(chatSettings.getByRole('combobox', { name: '聊天位置' })).toHaveAttribute(
    'aria-valuetext',
    '左下角',
  )
  await expect(chatSettings.getByRole('spinbutton', { name: '新消息显示时长' })).toHaveValue('9')
})

test('hover pauses only that danmaku while other messages continue and resumes on leave', async ({
  page,
  request,
}) => {
  await enterChat(page)
  await page.getByRole('switch', { name: '启用弹幕' }).check()
  await request.post('/test/room-mentions')
  const draft = page.getByRole('textbox', { name: '房间聊天内容' })
  await draft.fill('悬停暂停测试')
  await draft.press('Control+Enter')
  const target = page.locator('.mp-danmaku-message').filter({ hasText: '@晚风 这首歌很适合你' }),
    other = page.locator('.mp-danmaku-message').filter({ hasText: '@晚风向海 欢迎' })
  await expect(target).toBeAttached({ timeout: 10000 })
  await expect.poll(async () => (await target.boundingBox())?.x ?? 1100).toBeLessThan(750)
  const targetBox = (await target.boundingBox())!
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
  await expect(target).toHaveAttribute('data-paused', 'true')
  const targetBefore = (await target.boundingBox())!.x,
    otherBefore = (await other.boundingBox())!.x
  // Compare both simultaneous animations over the same interval.
  await page.waitForTimeout(800)
  expect(Math.abs((await target.boundingBox())!.x - targetBefore)).toBeLessThan(2)
  expect(otherBefore - (await other.boundingBox())!.x).toBeGreaterThan(30)
  // A hovered item must outlive its original 9-second scrolling lifetime.
  await page.waitForTimeout(9000)
  await expect(target).toBeVisible()
  expect(Math.abs((await target.boundingBox())!.x - targetBefore)).toBeLessThan(2)
  await page.mouse.move(1000, 800)
  await expect.poll(async () => targetBefore - (await target.boundingBox())!.x).toBeGreaterThan(30)
})
