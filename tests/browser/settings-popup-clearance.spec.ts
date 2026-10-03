import { expect, test } from '@playwright/test'

// tests/browser/settings-popup-clearance.spec.ts
for (const kind of ['chat', 'danmaku'] as const) {
  test(`${kind} settings keep the native player clearance while growing and resizing`, async ({
    page,
    request,
  }) => {
    await request.get('/test/reset')
    await page.setViewportSize({ width: 1100, height: 1020 })
    await page.goto('/')
    await page.getByTestId('unified-panel-surface').evaluate((node: HTMLElement) => {
      // Folia's desktop surface: 56px upper clearance and 32px bottom baseline.
      node.style.cssText =
        'position:fixed;right:32px;bottom:32px;margin:0;max-height:calc(100dvh - 88px)'
    })
    await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
    await page.getByRole('tab', { name: '聊天', exact: true }).click()
    await page.locator(`.mp-chat-settings-entry[data-settings="${kind}"] > summary`).click()
    const popup = page.locator(`.mp-chat-settings-popover[data-settings="${kind}"]`)
    await expect(popup).toBeVisible()
    await expect(popup).toHaveCSS('max-height', '932px')
    // A maximum is a ceiling, never a request to fill the whole player.
    expect((await popup.boundingBox())!.height).toBeLessThan(900)
    if (kind === 'chat') {
      await popup.getByRole('combobox', { name: '聊天位置' }).click()
      await popup.getByRole('option', { name: '左下角', exact: true }).click()
    } else {
      await popup.locator('.mp-chat-settings-advanced > summary').click()
    }
    for (const height of [620, 460, 850]) {
      await page.setViewportSize({ width: 1100, height })
      await expect(popup).toHaveCSS('max-height', `${height - 88}px`)
      await expect.poll(async () => (await popup.boundingBox())!.y).toBeGreaterThanOrEqual(56)
      await expect
        .poll(async () => {
          const bounds = (await popup.boundingBox())!
          return bounds.y + bounds.height
        })
        .toBeLessThanOrEqual(height - 32)
    }
  })
}
