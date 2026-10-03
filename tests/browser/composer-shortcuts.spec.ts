import { test, expect } from '@playwright/test'

// tests/browser/composer-shortcuts.spec.ts
test.beforeEach(async ({ page, request }) => {
  await request.get('/test/reset')
  await page.route('https://p1.music.126.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>',
    }),
  )
})

test('room Ctrl+Enter sends while Enter edits or selects mentions and IME does not send', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const draft = page.getByRole('textbox', { name: '房间聊天内容' })
  const sent = async () =>
    (await (await request.get('/test/state')).json()).calls.filter(
      (call: string) => call === '/api/middle/im/chatroom/send',
    ).length
  await draft.fill('第一行')
  await draft.press('Enter')
  await expect(draft).toHaveValue('第一行\n')
  expect(await sent()).toBe(0)
  await draft.fill('你好 @小')
  const mentions = page.getByRole('listbox', { name: '提及成员' })
  await expect(mentions).toBeVisible()
  await draft.press('Enter')
  await expect(draft).toHaveValue('你好 @小岛 ')
  expect(await sent()).toBe(0)
  await draft.dispatchEvent('compositionstart')
  await draft.press('Control+Enter')
  expect(await sent()).toBe(0)
  await draft.dispatchEvent('compositionend')
  await draft.dispatchEvent('keydown', {
    key: 'Enter',
    ctrlKey: true,
    isComposing: true,
    bubbles: true,
    cancelable: true,
  })
  expect(await sent()).toBe(0)
  await draft.press('Control+Enter')
  await expect.poll(sent).toBe(1)
  await expect(draft).toHaveValue('')
  // The send chord takes precedence over Enter's mention-selection behavior.
  await draft.fill('再听一首 @小')
  await expect(mentions).toBeVisible()
  await draft.press('Control+Enter')
  await expect.poll(sent).toBe(2)
  await expect(draft).toHaveValue('')
  await expect(mentions).toBeHidden()
})

test('private Ctrl+Enter sends exactly once and Enter keeps a multiline draft', async ({
  page,
  request,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const draft = page.getByRole('textbox', { name: '私信内容' })
  const sent = async () =>
    (await (await request.get('/test/state')).json()).calls.filter(
      (call: string) => call === 'privateSend',
    ).length
  await draft.fill('第一行')
  await draft.press('Enter')
  await draft.press('Shift+Enter')
  await expect(draft).toHaveValue('第一行\n\n')
  expect(await sent()).toBe(0)
  await draft.dispatchEvent('compositionstart')
  await draft.press('Control+Enter')
  expect(await sent()).toBe(0)
  await draft.dispatchEvent('compositionend')
  await draft.press('Control+Enter')
  await expect.poll(sent).toBe(1)
  await expect(draft).toHaveValue('')
  await draft.press('Control+Enter')
  expect(await sent()).toBe(1)
})

test('focus rediscovers a room joined elsewhere without taking over local playback', async ({
  page,
  request,
}) => {
  await request.post('/test/empty')
  await page.goto('/')
  const restore = page.getByRole('button', { name: '恢复当前房间', exact: true })
  await expect(page.getByRole('button', { name: '匹配房间', exact: true })).toBeEnabled()
  await expect(restore).toBeHidden()
  const before = await page.evaluate(() => ({ ...(window as any).partyTest.state }))
  // This is the local protocol mock, simulating an account joining on another device.
  await request.post('/api', {
    data: { uri: '/api/listen/together/multi/room/create', data: { songId: '1' } },
  })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(restore).toBeVisible()
  expect(await page.evaluate(() => ({ ...(window as any).partyTest.state }))).toEqual(before)
  expect(await page.evaluate(() => (window as any).partyTest.queue())).toBeUndefined()
})

test('focus and reconnect do not query room status while logged out', async ({ page, request }) => {
  await page.goto('/?loggedout')
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
  })
  expect((await (await request.get('/test/state')).json()).calls).not.toContain(
    '/api/listen/together/multi/match/status/get',
  )
})
