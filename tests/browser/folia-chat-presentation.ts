import { expect, test, type Page } from '@playwright/test'

// tests/browser/folia-chat-presentation.ts
// Exercise the real stage registry and nested host shadows with the suite's mock account.
export async function verifyNativeChatPresentation(page: Page): Promise<void> {
  const full = page.locator('.mp-floating-chat'),
    settings = page.locator('.mp-chat-settings-popover[data-settings="chat"]')
  const openSettings = async () => {
    await page.mouse.move(600, 100)
    if (!(await settings.isVisible()))
      await page.locator('.mp-chat-settings summary[aria-label="聊天显示"]').click()
    await expect(settings).toBeVisible()
  }
  const selectPosition = async (name: '左下角' | '面板内') => {
    const trigger = settings.getByRole('combobox', { name: '聊天位置' })
    await trigger.click()
    await settings
      .getByRole('listbox', { name: '聊天位置' })
      .getByRole('option', { name, exact: true })
      .click()
    await expect(trigger).toHaveAttribute('aria-valuetext', name)
  }
  try {
    await page.setViewportSize({ width: 1100, height: 1020 })
    await page.getByRole('textbox', { name: '房间聊天内容', exact: true }).fill('原生播放器草稿 😊')
    await openSettings()
    await selectPosition('左下角')
    await page.keyboard.press('Escape')
    await expect(
      page.locator('[data-folium-slot="app.overlay"] .mp-floating-chat'),
    ).toHaveAttribute('data-visible', 'true')
    await expect(full.locator('.mp-chat-view')).toHaveAttribute('data-live-composer', 'collapsed')
    await full.locator('.mp-live-compose-open').click()
    await expect(full.getByRole('textbox', { name: '房间聊天内容', exact: true })).toHaveValue(
      '原生播放器草稿 😊',
    )
    await expect(page.locator('.mp-chat-view')).toHaveCount(1)
    await expect
      .poll(async () => {
        const box = await full.boundingBox()
        return !!box && box.x >= 8 && box.x < 40 && box.y >= 8 && box.y + box.height <= 1012
      })
      .toBe(true)
    // The host card may disappear naturally during its configured timeout.
    // While it is present, the chat stays above it, without moving the host control.
    await expect
      .poll(async () => {
        const cards = page.locator('[data-toast-card]'),
          box = await full.boundingBox()
        if (!box) return false
        for (const card of await cards.all()) {
          if (!(await card.isVisible())) continue
          const cardBox = await card.boundingBox()
          if (!cardBox || cardBox.x >= box.x + box.width || cardBox.x + cardBox.width <= box.x)
            continue
          if (box.y + box.height > cardBox.y - 8) return false
        }
        return true
      })
      .toBe(true)
    for (const name of ['Emoji', '表情包']) {
      await page.mouse.move(600, 100)
      await full.locator(`summary[aria-label="${name}"]`).click()
      const popup = full.getByRole('dialog', { name, exact: true })
      await expect(popup).toBeVisible()
      await expect
        .poll(async () => {
          const box = await full.boundingBox(),
            floating = await popup.boundingBox()
          return (
            !!box &&
            !!floating &&
            floating.x >= box.x + box.width + 8 &&
            floating.x + floating.width <= 1092 &&
            floating.y >= 8 &&
            floating.y + floating.height <= 1012
          )
        })
        .toBe(true)
      if (name === '表情包') {
        await expect(popup.locator('.mp-sticker-grid button').first()).toBeVisible()
        await page.screenshot({
          path: test.info().outputPath('folia-floating-chat.png'),
          animations: 'disabled',
        })
      }
      await page.keyboard.press('Escape')
      await expect(popup).toBeHidden()
    }
    await expect(full.getByRole('textbox', { name: '房间聊天内容', exact: true })).toHaveValue(
      '原生播放器草稿 😊',
    )
  } finally {
    await page.keyboard.press('Escape')
    await page.evaluate(() => (window as any).partyHost.api.ui.openPlayerPanel('room'))
    await page.getByRole('tab', { name: '聊天', exact: true }).click()
    await page.getByRole('switch', { name: '启用弹幕' }).uncheck()
    await openSettings()
    await selectPosition('面板内')
    await page.keyboard.press('Escape')
    await page.getByRole('textbox', { name: '房间聊天内容', exact: true }).fill('')
    await page.setViewportSize({ width: 1100, height: 1020 })
    await expect(page.locator('.mp-panel .mp-chat-view')).toBeVisible()
  }
}
