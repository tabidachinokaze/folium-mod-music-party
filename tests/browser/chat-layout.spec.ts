import { expect, test } from '@playwright/test'

// tests/browser/chat-layout.spec.ts
test('empty and short histories size to content instead of filling the sidebar', async ({
  page,
  request,
}) => {
  await request.get('/test/reset')
  let count = 0
  await page.route('**/rpc', async (route) => {
    const payload = route.request().postDataJSON()
    if (payload.name !== 'call' || payload.args[0]?.method !== 'multiChatHistory')
      return route.continue()
    const response = await route.fetch(),
      body = await response.json()
    body.result.data.data.records = Array.from({ length: count }, (_, index) => ({
      sendUid: '10',
      nickname: '小岛',
      sendTime: Date.now() + index,
      msgType: 0,
      imChatRoomMsgBody: { text: `短消息 ${index}` },
    }))
    body.result.data.data.page = { more: false }
    return route.fulfill({ json: body })
  })
  for (count of [0, 2]) {
    await page.goto('/')
    await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
    await page.getByRole('tab', { name: '聊天', exact: true }).click()
    const chat = page.locator('.mp-chat-view'),
      history = chat.locator('.mp-history')
    if (!count) await expect(history.getByText('还没有聊天消息')).toBeVisible()
    else await expect(history.locator('.mp-message')).toHaveCount(count)
    await expect
      .poll(
        async () =>
          (await page.locator('.mp-panel').boundingBox())!.height -
          (await page.locator('.mp-chat-settings').boundingBox())!.height,
      )
      .toBeLessThan(350)
    expect(
      await history.evaluate((node) => node.scrollHeight - node.clientHeight),
    ).toBeLessThanOrEqual(1)
    await expect(chat.getByRole('button', { name: '发送', exact: true })).toBeInViewport()
    await page
      .locator('#panel')
      .screenshot({ path: test.info().outputPath(`chat-${count}-messages.png`) })
  }
})

test('chat reserves room for its composer and only the history scrolls below the host cover', async ({
  page,
  request,
}) => {
  await request.get('/test/reset')
  await request.post('/test/chat-pages')
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  const panel = page.locator('#panel')
  // Match the native cover + host tabs above the plugin's nested shadow surface.
  await panel.evaluate((node) => {
    const chrome = document.createElement('div')
    chrome.style.cssText = 'height:336px;flex:none'
    node.prepend(chrome)
  })
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const chat = page.locator('.mp-chat-view'),
    history = page.getByLabel('房间聊天记录'),
    send = chat.getByRole('button', { name: '发送', exact: true })
  for (const height of [960, 760, 880]) {
    await page.setViewportSize({ width: 1100, height })
    await expect
      .poll(() => panel.evaluate((node) => node.scrollHeight - node.clientHeight))
      .toBeLessThanOrEqual(1)
    await expect(send).toBeInViewport()
    await expect(history.getByText('聊天消息 79', { exact: true })).toBeInViewport()
    expect(await chat.locator('.mp-sticker-menu').boundingBox()).toBeNull()
    const bounds = (await panel.boundingBox())!,
      button = (await send.boundingBox())!
    expect(button.y + button.height).toBeLessThanOrEqual(bounds.y + bounds.height - 18)
    expect(await chat.evaluate((node) => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(
      1,
    )
    const before = await panel.evaluate((node) => node.scrollTop)
    await history.hover()
    await page.mouse.wheel(0, 1000)
    expect(await panel.evaluate((node) => node.scrollTop)).toBe(before)
  }
  await panel.screenshot({ path: test.info().outputPath('chat-contained.png') })
  await page.getByRole('tab', { name: '房间', exact: true }).click()
  await expect(page.getByRole('button', { name: '退出房间', exact: true })).toBeVisible()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await expect(send).toBeInViewport()
  await expect
    .poll(() => panel.evaluate((node) => node.scrollHeight - node.clientHeight))
    .toBeLessThanOrEqual(1)
})
