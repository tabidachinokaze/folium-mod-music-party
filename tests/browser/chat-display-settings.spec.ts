import { expect, test, type Locator, type Page } from '@playwright/test'

// tests/browser/chat-display-settings.spec.ts
async function enter(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
}
async function openSettings(page: Page, kind: 'chat' | 'danmaku' = 'chat') {
  await page
    .locator(`.mp-chat-settings summary[aria-label="${kind === 'chat' ? '聊天显示' : '弹幕设置'}"]`)
    .click()
  return page.locator(`.mp-chat-settings-popover[data-settings="${kind}"]`)
}
async function select(container: Locator, name: string, option: string) {
  await container.getByRole('combobox', { name, exact: true }).click()
  await container
    .getByRole('listbox', { name, exact: true })
    .getByRole('option', { name: option, exact: true })
    .click()
}
async function slider(container: Locator, name: string, value: number) {
  await container.getByRole('slider', { name, exact: true }).evaluate((node, value) => {
    ;(node as HTMLInputElement).value = String(value)
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}
test.beforeEach(async ({ request, page }) => {
  await request.get('/test/reset')
  await page.setViewportSize({ width: 1100, height: 850 })
})

test('settings navigation keeps chat and danmaku separate and nested dropdowns dismiss one level at a time', async ({
  page,
}) => {
  await enter(page)
  const toggle = page.getByRole('switch', { name: '启用弹幕' })
  await toggle.check()
  await expect(page.locator('.mp-chat-settings-popover:popover-open')).toHaveCount(0)
  await toggle.uncheck()
  const chat = await openSettings(page),
    trigger = chat.getByRole('combobox', { name: '聊天位置' }),
    list = chat.getByRole('listbox', { name: '聊天位置' })
  await trigger.click()
  await expect(list).toBeVisible()
  await expect(chat).toBeVisible()
  await expect(list).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.94)')
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await expect(chat).toBeVisible()
  await expect(trigger).toBeFocused()
  await trigger.press('ArrowDown')
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('aria-valuetext', '左下角')
  await expect(list).toBeHidden()
  await expect(chat).toBeVisible()
  // Sticker groups may refresh in a different order; keyboard navigation follows the visible rows.
  await chat.locator('select').evaluate((node: HTMLSelectElement) => {
    node.replaceChildren(...[...node.options].reverse())
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await trigger.click()
  await page.keyboard.press('Home')
  await expect(list.getByRole('option', { name: '左下角', exact: true })).toBeFocused()
  await page.keyboard.press('Escape')
  await page.screenshot({ path: test.info().outputPath('chat-navigation.png') })
  const danmaku = await openSettings(page, 'danmaku')
  await expect(chat).toBeHidden()
  await danmaku.locator('.mp-chat-settings-advanced > summary').click()
  await danmaku.getByRole('combobox', { name: '字体' }).click()
  const fontMenu = danmaku.getByRole('listbox', { name: '字体' })
  await expect(fontMenu).toBeVisible()
  // Parent closure also cleans up its child and the active-popup stack.
  await danmaku.evaluate((node: HTMLElement) => node.hidePopover())
  await expect(fontMenu).toBeHidden()
  await openSettings(page)
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(chat).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(chat).toBeHidden()
  await page.getByRole('combobox', { name: '预览主题' }).selectOption('light')
  await openSettings(page)
  await trigger.click()
  await expect(list).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.96)')
  await page.screenshot({ path: test.info().outputPath('chat-select-light.png') })
  await page.mouse.click(1080, 10)
  await expect(list).toBeHidden()
  await expect(chat).toBeHidden()
})

test('floating chat uses available height without scrollbars and applies separate appearance controls', async ({
  page,
  request,
}) => {
  await request.post('/test/chat-pages')
  await enter(page)
  await page.evaluate(() => {
    const obstacle = document.createElement('div')
    obstacle.dataset.toastCard = ''
    obstacle.style.cssText =
      'position:fixed;left:24px;bottom:32px;width:260px;height:70px;background:#333'
    const back = document.createElement('button')
    back.dataset.playerTopObstacle = ''
    back.textContent = '‹'
    back.style.cssText = 'position:fixed;left:24px;top:24px;width:40px;height:40px'
    document.body.append(obstacle, back)
  })
  const settings = await openSettings(page)
  await select(settings, '聊天位置', '左下角')
  await slider(settings, '消息不透明度', 55)
  await slider(settings, '消息气泡不透明度', 60)
  await slider(settings, '输入区背景不透明度', 20)
  await slider(settings, '聊天字号', 125)
  await slider(settings, '聊天行距', 130)
  await page.keyboard.press('Escape')
  const floating = page.locator('.mp-floating-chat'),
    history = floating.locator('.mp-history')
  await expect(history).toHaveCSS('scrollbar-width', 'none')
  await expect(history).toHaveCSS('opacity', '0.55')
  await expect.poll(async () => (await history.boundingBox())!.height).toBeGreaterThan(400)
  await expect
    .poll(async () => {
      const box = (await floating.boundingBox())!,
        obstacle = (await page.locator('[data-toast-card]').boundingBox())!
      return box.y >= 75 && obstacle.y - box.y - box.height >= 11
    })
    .toBe(true)
  await floating.locator('.mp-live-compose-open').click()
  const composer = floating.locator('.mp-composer'),
    bubble = history.locator('.mp-bubble').first(),
    message = history.locator('.mp-message').first()
  await expect(message).toHaveCSS('border-radius', '12px')
  await expect(message).toHaveCSS('background-color', /(?:\/ 0\.6\)|, 0\.6\))/)
  await expect(bubble).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(composer).toHaveCSS('opacity', '1')
  await expect(composer).toHaveCSS('background-color', /(?:\/ 0\.2\)|, 0\.2\))/)
  await expect(composer.locator('textarea')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(composer.locator('textarea')).toHaveCSS('font-size', '15px')
  await expect(bubble).toHaveCSS('font-size', '15px')
  await composer.locator('summary[aria-label="Emoji"]').click()
  const emoji = floating.getByRole('dialog', { name: 'Emoji', exact: true })
  await expect(emoji).toHaveCSS('opacity', '1')
  await expect(emoji).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.94)')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: test.info().outputPath('floating-chat-appearance.png') })
  await page.setViewportSize({ width: 900, height: 550 })
  await expect
    .poll(async () => {
      const box = (await floating.boundingBox())!,
        obstacle = (await page.locator('[data-toast-card]').boundingBox())!,
        editor = (await composer.boundingBox())!
      return (
        box.y >= 75 &&
        box.y + box.height <= obstacle.y - 11 &&
        editor.y + editor.height <= box.y + box.height + 1
      )
    })
    .toBe(true)
  await page.reload()
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await expect(history).toHaveCSS('opacity', '0.55')
  await expect(message).toHaveCSS('background-color', /(?:\/ 0\.6\)|, 0\.6\))/)
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await openSettings(page)
  await expect(settings.getByRole('slider', { name: '聊天字号' })).toHaveValue('125')
  await settings.getByRole('button', { name: '恢复聊天显示默认设置' }).click()
  await expect(settings.getByRole('combobox', { name: '聊天位置' })).toHaveAttribute(
    'aria-valuetext',
    '左下角',
  )
  await expect(settings.getByRole('slider', { name: '消息不透明度' })).toHaveValue('100')
  await expect(settings.getByRole('slider', { name: '消息气泡不透明度' })).toHaveValue('35')
  await expect(settings.getByRole('slider', { name: '输入区背景不透明度' })).toHaveValue('45')
})

test('floating bubbles keep text readable at zero background opacity and follow the theme accent', async ({
  page,
  request,
}) => {
  await request.post('/test/room-layout')
  await enter(page)
  const settings = await openSettings(page)
  await select(settings, '聊天位置', '左下角')
  const floating = page.locator('.mp-floating-chat'),
    messages = floating.locator('.mp-message'),
    author = floating.locator('.mp-meta .mp-message-author').first()
  await slider(settings, '消息气泡不透明度', 0)
  await expect(messages.first()).toHaveCSS('background-color', /(?:\/ 0\)|, 0\))/)
  await expect(floating.locator('.mp-history')).toHaveCSS('opacity', '1')
  await page.keyboard.press('Escape')
  for (const [theme, accent] of [
    ['blue', 'rgb(133, 184, 232)'],
    ['light', 'rgb(54, 101, 175)'],
  ]) {
    await page.getByRole('combobox', { name: '预览主题' }).selectOption(theme!)
    await expect(author).toHaveCSS('color', accent!)
  }
  await openSettings(page)
  await slider(settings, '消息气泡不透明度', 100)
  await expect(messages.first()).toHaveCSS(
    'background-color',
    /(?:srgb 0\.9686|rgb\(247, 247, 245)/,
  )
  await slider(settings, '消息气泡不透明度', 35)
  await page.keyboard.press('Escape')
  // Long names/URLs and activity rows wrap inside the same bounded bubble.
  for (const row of await messages.all()) {
    await expect(row).toHaveCSS('border-radius', '12px')
    expect(await row.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  }
  await page.screenshot({ path: test.info().outputPath('floating-bubbles-light.png') })
  await openSettings(page)
  await select(settings, '聊天位置', '面板内')
  await page.keyboard.press('Escape')
  await expect(page.locator('.mp-panel .mp-message').first()).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
})
