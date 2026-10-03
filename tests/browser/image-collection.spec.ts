import { expect, test } from '@playwright/test'

// tests/browser/image-collection.spec.ts
test('room image menus stay usable in a fixed player shell and across chat refreshes', async ({
  page,
  request,
}) => {
  await request.get('/test/reset')
  let historyReads = 0,
    appendMessage = false
  const fixtures = [
    { sendUid: 9, emojiId: 0, emojiGroupId: 0, width: 2560, height: 1392, format: 'png' },
    { sendUid: 10, emojiId: 773, emojiGroupId: 1, width: 320, height: 240, format: 'jpeg' },
    { sendUid: 9, emojiId: 0, emojiGroupId: 0, width: 1238, height: 894, format: 'png' },
  ]
  await page.route('https://p1.music.126.net/fixture_no_extension_*', (route) => {
    const index = Number(new URL(route.request().url()).pathname.split('_').at(-1)),
      fixture = fixtures[index]
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${fixture.width}" height="${fixture.height}"/>`,
    })
  })
  await page.route('**/rpc', async (route) => {
    const payload = route.request().postDataJSON()
    if (payload.name !== 'call' || payload.args[0]?.method !== 'multiChatHistory')
      return route.continue()
    const response = await route.fetch(),
      body = await response.json()
    historyReads++
    body.result.data.data.records = fixtures.map((fixture, index) => ({
      sendUid: fixture.sendUid,
      nickname: fixture.sendUid === 9 ? '晚风' : '小岛',
      sendTime: 1791040000000 + index,
      msgType: 0,
      emoji: {
        ...fixture,
        emojiName: 'image.png',
        emojiImgUrl: `https://p1.music.126.net/fixture_no_extension_${index}`,
      },
      imChatRoomMsgBody: { text: '[image.png]' },
    }))
    if (appendMessage)
      body.result.data.data.records.push({
        sendUid: 10,
        nickname: '小岛',
        sendTime: 1791040000004,
        msgType: 0,
        imChatRoomMsgBody: { text: '新的聊天消息' },
      })
    return route.fulfill({ json: body })
  })
  await page.goto('/')
  // Folia's fixed app shell does not give body a layout height. Its overflow
  // belongs to the viewport, not an empty rectangular clipping ancestor.
  await page.evaluate(() => {
    const shell = document.createElement('div')
    shell.style.cssText = 'position:fixed;inset:0;overflow:hidden'
    shell.append(...document.body.childNodes)
    document.body.append(shell)
    document.body.style.overflow = 'hidden'
  })
  await expect.poll(() => page.evaluate(() => document.body.getBoundingClientRect().height)).toBe(0)
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const chat = page.locator('.mp-chat-view'),
    menu = chat.getByRole('menu'),
    images = chat.locator('.mp-message-content img')
  await expect(images).toHaveCount(3)
  for (const image of await images.all()) {
    await image.click({ button: 'right' })
    await expect(
      menu.getByRole('menuitem', { name: '添加到我的表情包', exact: true }),
    ).toBeVisible()
    await expect
      .poll(async () => {
        const popup = await menu.boundingBox(),
          history = await chat.locator('.mp-history').boundingBox()
        return (
          !!popup &&
          !!history &&
          popup.y >= history.y &&
          popup.y + popup.height <= history.y + history.height
        )
      })
      .toBe(true)
    await page.keyboard.press('Escape')
  }
  const lastImage = images.last()
  await lastImage.click({ button: 'right' })
  await lastImage.evaluate((node) => {
    ;(window as any).openedMessageImage = node
  })
  const before = historyReads
  appendMessage = true
  await expect.poll(() => historyReads, { timeout: 10000 }).toBeGreaterThan(before)
  await expect(chat.getByText('新的聊天消息', { exact: true })).toBeVisible()
  await expect(menu).toBeVisible()
  expect(await lastImage.evaluate((node) => node === (window as any).openedMessageImage)).toBe(true)
  await page.keyboard.press('Escape')
  const calls = (await (await request.get('/test/state')).json()).calls
  expect(calls).not.toContain('saveSticker')
})

test('own room and private images can be saved as stickers without treating avatars as messages', async ({
  page,
  request,
}) => {
  await request.get('/test/reset')
  const saved: any[] = []
  const url = 'https://p1.music.126.net/fixture/own-image.gif'
  const emoji = {
    emojiId: '773',
    emojiGroupId: '-1',
    emojiName: '我的表情',
    emojiImgUrl: 'https://p1.music.126.net/fixture/own-sticker.gif',
    width: 120,
    height: 180,
    format: 'gif',
  }
  await page.route('https://p1.music.126.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="180"/>',
    }),
  )
  await page.route('**/rpc', async (route) => {
    const payload = route.request().postDataJSON()
    if (payload.name === 'saveSticker') {
      saved.push(payload.args[0])
      return route.fulfill({
        json: {
          ok: true,
          result:
            payload.args[0].kind === 'image'
              ? { ...emoji, emojiId: String(800 + saved.length), emojiImgUrl: payload.args[0].url }
              : true,
        },
      })
    }
    const method = payload.name === 'call' ? payload.args[0]?.method : ''
    if (!['multiChatHistory', 'privateHistory'].includes(method)) return route.continue()
    const response = await route.fetch(),
      body = await response.json()
    if (method === 'multiChatHistory') {
      body.result.data.data.records = [
        { emoji: { ...emoji, emojiId: '0', emojiGroupId: '0', emojiImgUrl: url }, offset: 0 },
        { emoji, offset: 1 },
      ].map(({ emoji: item, offset }) => ({
        sendUid: '9',
        nickname: '晚风',
        avatarUrl: 'https://p1.music.126.net/fixture/avatar.gif',
        sendTime: 1791040000000 + offset,
        msgType: 0,
        emoji: item,
        imChatRoomMsgBody: { text: `[${item.emojiName}]` },
      }))
    } else
      body.result.data.msgs.push({
        id: 9002,
        time: Date.now(),
        fromUser: {
          userId: 9,
          nickname: '晚风',
          avatarUrl: 'https://p1.music.126.net/fixture/avatar.gif',
        },
        toUser: { userId: 10 },
        msgType: 1,
        msg: JSON.stringify({
          msg: '图片',
          pics: [{ url: 'https://p1.music.126.net/fixture/private-own.gif' }],
        }),
      })
    return route.fulfill({ json: body })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const chat = page.locator('.mp-chat-view'),
    ownImage = chat.locator(`.mp-message-content img[src="${url}"]`)
  await expect(ownImage).toBeVisible()
  await ownImage.click({ button: 'right' })
  await chat.getByRole('menuitem', { name: '添加到我的表情包', exact: true }).click()
  await expect.poll(() => saved.length).toBe(1)
  expect(saved[0]).toMatchObject({ kind: 'image', url, width: 120, height: 180 })
  await ownImage.click({ button: 'right' })
  await expect(
    chat.getByRole('menuitem', { name: '已添加到我的表情包', exact: true }),
  ).toBeDisabled()
  await page.keyboard.press('Escape')
  await chat
    .locator(`.mp-message-content img[src="${emoji.emojiImgUrl}"]`)
    .click({ button: 'right' })
  await chat.getByRole('menuitem', { name: '添加到我的表情包', exact: true }).click()
  await expect.poll(() => saved.length).toBe(2)
  expect(saved[1]).toEqual(emoji)
  await chat.locator('.mp-message-avatar img').first().click({ button: 'right' })
  await expect(chat.getByRole('menu')).toBeHidden()
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const home = page.locator('.mp-private-home')
  await home
    .locator('[data-message-id="server:9002"] .mp-message-content img')
    .click({ button: 'right' })
  await home.getByRole('menuitem', { name: '添加到我的表情包', exact: true }).click()
  await expect.poll(() => saved.length).toBe(3)
  expect(saved[2]).toMatchObject({
    kind: 'image',
    url: 'https://p1.music.126.net/fixture/private-own.gif',
  })
  const calls = (await (await request.get('/test/state')).json()).calls
  expect(calls).not.toContain('privateSend')
  expect(calls).not.toContain('/api/middle/im/chatroom/send')
})
