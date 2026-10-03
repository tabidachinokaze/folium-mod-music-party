import { expect, test } from '@playwright/test'

// tests/browser/message-media.spec.ts
const sticker = {
  emojiId: '12345678901234567890',
  emojiGroupId: '-1',
  emojiName: '收到的表情',
  emojiImgUrl: 'https://p1.music.126.net/fixture/109951166199016466.jpg',
  width: 120,
  height: 180,
  format: 'gif',
}
test.beforeEach(async ({ page, request }) => {
  await request.get('/test/reset')
  await page.route('https://p1.music.126.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"/>',
    }),
  )
})

test('received stickers hide app fallback and collection merges the picker without rebuilding existing images', async ({
  page,
  request,
}) => {
  const saved: any[] = []
  let pages = 0
  await page.route('**/rpc', async (route) => {
    const payload = route.request().postDataJSON()
    if (payload.name === 'saveSticker') {
      saved.push(payload.args[0])
      return route.fulfill({ json: { ok: true, result: true } })
    }
    const method = payload.name === 'call' ? payload.args[0]?.method : ''
    if (method === 'stickerPage') pages++
    if (!['multiChatHistory', 'privateHistory'].includes(method)) return route.continue()
    const reply = await route.fetch(),
      data = await reply.json()
    if (method === 'multiChatHistory')
      data.result.data.data.records.push({
        sendUid: '10',
        nickname: '小岛',
        sendTime: Date.now(),
        msgType: 0,
        emoji: sticker,
        imChatRoomMsgBody: { text: '（升级App到最新版本即可查看该消息）' },
      })
    else
      data.result.data.msgs.push({
        id: 9001,
        time: Date.now(),
        fromUser: { userId: 10, nickname: '小岛' },
        toUser: { userId: 9 },
        msgType: 1,
        msg: '（升级App到最新版本即可查看该消息）',
        body: JSON.stringify({ ...sticker, url: sticker.emojiImgUrl, name: sticker.emojiName }),
      })
    return route.fulfill({ json: data })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const chat = page.locator('.mp-chat-view'),
    roomImage = chat.locator('.mp-history .mp-message img').last()
  await expect(roomImage).toBeVisible()
  await expect(chat.getByText('（升级App到最新版本即可查看该消息）', { exact: true })).toHaveCount(
    0,
  )
  await chat.locator('summary[aria-label="表情包"]').click()
  await expect(chat.getByRole('button', { name: '开心', exact: true })).toBeVisible()
  const retainedImage = await chat
    .getByRole('button', { name: '开心', exact: true })
    .locator('img')
    .elementHandle()
  const before = pages
  await page.keyboard.press('Escape')
  expect(await chat.locator('.mp-sticker-menu').boundingBox()).toBeNull()
  await roomImage.click({ button: 'right' })
  const menu = chat.getByRole('menu', { name: '表情包操作' })
  await expect(menu).toBeVisible()
  await expect
    .poll(async () => {
      const image = (await roomImage.boundingBox())!,
        popup = (await menu.boundingBox())!,
        history = (await chat.locator('.mp-history').boundingBox())!
      return (
        popup.y >= history.y &&
        popup.y + popup.height <= history.y + history.height &&
        popup.x < image.x + image.width &&
        popup.x + popup.width > image.x &&
        (Math.abs(popup.y + popup.height - image.y) <= 12 ||
          Math.abs(image.y + image.height - popup.y) <= 12)
      )
    })
    .toBe(true)
  await menu.screenshot({ path: test.info().outputPath('sticker-context-menu.png') })
  await page.keyboard.press('Escape')
  expect(await chat.locator('.mp-sticker-menu').boundingBox()).toBeNull()
  await roomImage.click({ button: 'right' })
  await chat.getByRole('menuitem', { name: '添加到我的表情包' }).click()
  await expect.poll(() => saved.length).toBe(1)
  expect(saved[0]).toEqual(sticker)
  await chat.locator('summary[aria-label="表情包"]').click()
  await expect.poll(() => pages).toBeGreaterThan(before)
  await expect(chat.getByRole('button', { name: '开心', exact: true })).toBeVisible()
  expect(
    await chat
      .getByRole('button', { name: '开心', exact: true })
      .locator('img')
      .evaluate((image, retained) => image.isSameNode(retained), retainedImage),
  ).toBe(true)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const home = page.locator('.mp-private-home'),
    privateImage = home.locator('[data-message-id="server:9001"] img').last()
  await expect(privateImage).toBeVisible()
  await expect(home.getByText('（升级App到最新版本即可查看该消息）', { exact: true })).toHaveCount(
    0,
  )
  await privateImage.click({ button: 'right' })
  await expect(home.getByRole('menuitem', { name: '已添加到我的表情包' })).toBeDisabled()
  expect(saved).toHaveLength(1)
  await home.screenshot({ path: test.info().outputPath('received-sticker.png') })
  const calls = (await (await request.get('/test/state')).json()).calls
  expect(calls).not.toContain('privateSend')
  expect(calls).not.toContain('/api/middle/im/chatroom/send')
})

test('room and private clipboard images preview, cancel, and send only after confirmation', async ({
  page,
}) => {
  const uploads: any[] = []
  await page.route('**/rpc', (route) => {
    const payload = route.request().postDataJSON()
    if (payload.name !== 'media') return route.continue()
    uploads.push(payload.args[0])
    return route.fulfill({ json: { ok: true, result: { ok: true } } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  for (const scope of ['room', 'private']) {
    if (scope === 'private') {
      await page.getByRole('button', { name: '私信', exact: true }).click()
      await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
    }
    const root = page.locator(scope === 'room' ? '.mp-chat-view' : '.mp-private-home'),
      draft = root.getByRole('textbox', { name: scope === 'room' ? '房间聊天内容' : '私信内容' })
    const paste = async () =>
      draft.evaluate((node) => {
        const data = new DataTransfer(),
          bytes = Uint8Array.from(
            atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
            (ch) => ch.charCodeAt(0),
          )
        data.items.add(new File([bytes], 'clipboard.gif', { type: 'image/gif' }))
        const event = new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
        node.dispatchEvent(event)
        return event.defaultPrevented
      })
    const before = uploads.length
    expect(await paste()).toBe(true)
    const preview = root.getByRole('img', { name: '待发送图片预览' })
    await expect(preview).toBeVisible()
    expect(uploads).toHaveLength(before)
    await page.keyboard.press('Escape')
    await expect(preview).not.toBeVisible()
    expect(uploads).toHaveLength(before)
    expect(await paste()).toBe(true)
    await expect(preview).toBeVisible()
    await root
      .locator('.mp-image-picker')
      .getByRole('button', { name: '发送图片', exact: true })
      .click()
    await expect.poll(() => uploads.length).toBe(before + 1)
    expect(uploads[before].target).toEqual(
      scope === 'room' ? { kind: 'room', roomId: 'official_room' } : { kind: 'private', uid: '10' },
    )
    const prevented = await draft.evaluate((node) => {
      const data = new DataTransfer()
      data.setData('text/plain', '普通文字')
      const event = new ClipboardEvent('paste', { clipboardData: data, cancelable: true })
      node.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(prevented).toBe(false)
  }
})
