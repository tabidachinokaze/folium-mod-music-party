import { expect, type Page, type Route } from '@playwright/test'

// tests/browser/folia-sticker-menu.ts
// The actual host uses nested shadow roots beneath a fixed player shell. Keep
// its CSS/layout intact: document body can be height zero while chat is visible.
export async function verifyNativeStickerMenu(page: Page) {
  const imageUrl = 'https://p1.music.126.net/fixture_native_menu_image'
  await page.route(imageUrl, (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1392"/>',
    }),
  )
  const history = async (route: Route) => {
    const payload = route.request().postDataJSON()
    if (payload.name !== 'call' || payload.args[0]?.method !== 'multiChatHistory')
      return route.fallback()
    const response = await route.fetch(),
      body = await response.json()
    body.result.data.data.records = [
      {
        sendUid: 9,
        nickname: '晚风',
        sendTime: 1791040000000,
        msgType: 0,
        emoji: {
          emojiId: 0,
          emojiGroupId: 0,
          emojiName: 'image.png',
          format: 'png',
          width: 2560,
          height: 1392,
          emojiImgUrl: imageUrl,
        },
        imChatRoomMsgBody: { text: '[image.png]' },
      },
    ]
    return route.fulfill({ json: body })
  }
  await page.route('**/rpc', history)
  try {
    await page.evaluate(() => (window as any).partyHost.api.ui.openPlayerPanel('room'))
    await page.getByRole('tab', { name: '聊天', exact: true }).click()
    const chat = page.locator('.mp-chat-view'),
      image = chat.locator(`.mp-message-content img[src="${imageUrl}"]`),
      menu = chat.getByRole('menu')
    await expect(image).toBeVisible({ timeout: 10000 })
    expect(await page.evaluate(() => document.body.getBoundingClientRect().height)).toBe(0)
    await image.click({ button: 'right' })
    await expect(
      menu.getByRole('menuitem', { name: '添加到我的表情包', exact: true }),
    ).toBeVisible()
    await expect
      .poll(async () => {
        const popup = await menu.boundingBox(),
          list = await chat.locator('.mp-history').boundingBox()
        return (
          !!popup && !!list && popup.y >= list.y && popup.y + popup.height <= list.y + list.height
        )
      })
      .toBe(true)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  } finally {
    await page.unroute('**/rpc', history)
  }
}
