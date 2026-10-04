import { expect, test } from '@playwright/test'

test.beforeEach(async ({ request }) => {
  await request.get('/test/reset')
})

for (const [mode, label] of [
  ['scroll', '滚动'],
  ['top', '顶部'],
  ['bottom', '底部'],
] as const) {
  test(`${mode} danmaku displays complete text and activity usernames`, async ({ page }) => {
    let records: object[] = []
    await page.route('**/rpc', (route) => {
      const body = route.request().postDataJSON()
      if (body.name !== 'call' || body.args[0]?.method !== 'multiChatHistory')
        return route.continue()
      return route.fulfill({
        json: {
          ok: true,
          result: { ok: true, data: { code: 200, data: { records, page: { more: false } } } },
        },
      })
    })
    await page.goto('/')
    await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
    await page.getByRole('tab', { name: '聊天', exact: true }).click()
    await page.locator('.mp-chat-settings summary[aria-label="弹幕设置"]').click()
    const settings = page.locator('.mp-chat-settings-popover[data-settings="danmaku"]')
    await settings.getByRole('button', { name: label, exact: true }).click()
    await settings.getByRole('slider', { name: '字号', exact: true }).evaluate((node) => {
      ;(node as HTMLInputElement).value = '150'
      node.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.keyboard.press('Escape')
    await page.getByRole('switch', { name: '启用弹幕' }).check()
    const nickname = 'tabidachinokaze_music',
      actor = 'ミクといっしょに音楽を聴きたい',
      timestamp = Date.now() + 1000
    records = [
      {
        sendUid: '10',
        sendTime: timestamp,
        nickname,
        msgType: 0,
        imChatRoomMsgBody: { text: '欢迎一起听歌 😊 ' + '正文可以适当省略。'.repeat(20) },
      },
      {
        sendUid: '11',
        sendTime: timestamp + 1,
        nickname: actor,
        msgType: 3,
        imChatRoomMsgBody: { text: `${actor}推荐了歌曲：《海边》` },
      },
    ]
    const live = page.locator('.mp-danmaku-host:not([data-preview="true"])'),
      comments = live.locator('.mp-danmaku-message'),
      authors = comments.locator('.mp-danmaku-author')
    await expect(comments).toHaveCount(2, { timeout: 10000 })
    await expect(live.locator('.mp-danmaku')).toHaveAttribute('data-mode', mode)
    await expect(authors).toHaveText([`${nickname}:`, actor])
    // Compare text's actual glyph bounds with its element rather than only
    // checking textContent, which still contains the full name when ellipsized.
    await expect
      .poll(() =>
        authors.evaluateAll((nodes) =>
          nodes.every((node) => {
            const rect = node.getBoundingClientRect()
            return rect.left >= 0 && rect.right <= window.innerWidth
          }),
        ),
      )
      .toBe(true)
    const bounds = await authors.evaluateAll((nodes) =>
      nodes.map((node) => {
        const range = document.createRange()
        range.selectNodeContents(node)
        const author = node.getBoundingClientRect(),
          row = node.parentElement!.getBoundingClientRect()
        return {
          width: author.width,
          fullTextWidth: range.getBoundingClientRect().width,
          overflow: node.scrollWidth - node.clientWidth,
          inRow: author.left >= row.left && author.right <= row.right,
        }
      }),
    )
    for (const author of bounds) {
      expect(author.width).toBeGreaterThan(120)
      expect(author.width).toBeGreaterThanOrEqual(author.fullTextWidth - 1)
      expect(author.overflow).toBeLessThanOrEqual(1)
      expect(author.inRow).toBe(true)
    }
    await expect(comments.locator('.mp-danmaku-text').last()).toHaveText('推荐了歌曲：《海边》')
    await expect(comments.last()).toHaveText(`${actor}推荐了歌曲：《海边》`)
  })
}
