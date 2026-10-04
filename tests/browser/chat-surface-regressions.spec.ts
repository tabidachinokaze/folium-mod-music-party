import { expect, test } from '@playwright/test'

// tests/browser/chat-surface-regressions.spec.ts
test.beforeEach(async ({ request }) => {
  await request.get('/test/reset')
})

test('empty chat uses opaque tonal text in panel and floating layouts', async ({ page }) => {
  await page.route('**/rpc', (route) => {
    const body = route.request().postDataJSON()
    if (body.name !== 'call' || body.args[0]?.method !== 'multiChatHistory') return route.continue()
    return route.fulfill({
      json: {
        ok: true,
        result: {
          ok: true,
          data: {
            code: 200,
            data: { records: [], page: { more: false } },
          },
        },
      },
    })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  for (const position of ['面板内', '左下角']) {
    await page.locator('.mp-chat-settings summary[aria-label="聊天显示"]').click()
    const popup = page.locator('.mp-chat-settings-popover[data-settings="chat"]')
    await popup.getByRole('combobox', { name: '聊天位置' }).click()
    await popup.getByRole('option', { name: position, exact: true }).click()
    await page.keyboard.press('Escape')
    const empty = page.getByText('还没有聊天消息', { exact: true })
    await expect(empty).toBeVisible()
    const colors = []
    for (const theme of ['blue', 'light']) {
      await page.getByRole('combobox', { name: '预览主题' }).selectOption(theme)
      colors.push(
        await empty.evaluate((node) => {
          const color = getComputedStyle(node).color,
            canvas = document.createElement('canvas'),
            context = canvas.getContext('2d')!
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
          return { color, alpha: context.getImageData(0, 0, 1, 1).data[3] }
        }),
      )
    }
    expect(colors[0]!.color).not.toBe(colors[1]!.color)
    expect(colors.every((color) => color.alpha === 255)).toBe(true)
  }
})

test('private composer and its focus ring stay inside narrow conversation bounds', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const draft = page.getByRole('textbox', { name: '私信内容' })
  await draft.fill('很长的私信草稿'.repeat(100) + '\n第二行')
  for (const width of [1100, 640, 440, 320]) {
    await page.setViewportSize({ width, height: 640 })
    await draft.press('End')
    const bounds = await draft.evaluate((node) => {
      const rect = node.getBoundingClientRect(),
        form = node.closest('form')!.getBoundingClientRect(),
        conversation = node.closest('.mp-private-conversation')!,
        outer = conversation.getBoundingClientRect(),
        style = getComputedStyle(node),
        ring = Math.max(0, parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset))
      return {
        inside:
          rect.left - ring >= form.left &&
          rect.right + ring <= form.right + 1 &&
          rect.top - ring >= form.top &&
          rect.bottom + ring <= form.bottom + 1 &&
          form.left >= outer.left &&
          form.right <= outer.right + 1,
        overflow: conversation.scrollWidth - conversation.clientWidth,
      }
    })
    expect(bounds.inside).toBe(true)
    expect(bounds.overflow).toBeLessThanOrEqual(1)
  }
  await page.screenshot({ path: test.info().outputPath('private-composer-contained.png') })
})
