import { expect, test } from '@playwright/test'

// tests/browser/room-recovery.spec.ts
test('discovering an existing room during creation leaves a usable recovery card', async ({
  page,
  request,
}) => {
  await request.get('/test/reset')
  let checks = 0
  await page.route('**/rpc', async (route) => {
    const payload = route.request().postDataJSON()
    if (payload.name !== 'call' || payload.args[0]?.method !== 'multiStatus' || checks++ > 0)
      return route.continue()
    const response = await route.fetch(),
      body = await response.json()
    // The account joins on another client after the initial lobby discovery.
    body.result.data.data.multiLtRoomSnapshot = null
    return route.fulfill({ json: body })
  })
  await page.goto('/')
  const resume = page.getByRole('button', { name: '恢复当前房间', exact: true })
  await expect(page.getByRole('button', { name: '创建', exact: true })).toBeEnabled()
  await expect(resume).toBeHidden()
  const before = await page.evaluate(() => ({ ...(window as any).partyTest.state }))
  await page.getByRole('button', { name: '创建', exact: true }).click()
  await expect(page.locator('[data-host-toast=error]')).toContainText('账号已经在多人房间中')
  await expect(resume).toBeVisible()
  await expect(resume).toBeEnabled()
  expect(await page.evaluate(() => ({ ...(window as any).partyTest.state }))).toEqual(before)
  const calls = (await (await request.get('/test/state')).json()).calls
  expect(calls).not.toContain('/api/listen/together/multi/room/create')
  await resume.click()
  await expect(page.getByRole('tab', { name: '聊天', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '房间信息', exact: true })).toBeVisible()
})

for (const locale of ['zh-CN', 'en']) {
  test(`creating uses the card song without changing playback first (${locale})`, async ({
    page,
    request,
  }) => {
    await request.get('/test/reset')
    await request.post('/test/empty')
    await page.goto('/')
    if (locale === 'en')
      await page.getByRole('combobox', { name: 'Preview language' }).selectOption('en')
    const english = locale === 'en'
    const create = page.getByRole('button', { name: english ? 'Create' : '创建', exact: true })
    await expect(create).toBeEnabled()
    await expect(
      page.getByText(
        english
          ? 'Create a room with the selected song, or find people who share your taste.'
          : '用所选歌曲创建房间，或寻找同样喜欢音乐的人。',
        { exact: true },
      ),
    ).toBeVisible()
    const before = await page.evaluate(() => JSON.stringify((window as any).partyTest.state))
    await page
      .getByRole('button', { name: english ? 'Change song' : '切换歌曲', exact: true })
      .click()
    const picker = page.getByRole('dialog', {
      name: english ? 'Choose a matching song' : '选择匹配歌曲',
    })
    await picker
      .getByRole('searchbox', { name: english ? 'Search NetEase songs' : '搜索网易云歌曲' })
      .fill('山海')
    await picker.getByRole('button', { name: english ? 'Search' : '搜索', exact: true }).click()
    await picker
      .getByRole('button', {
        name: english ? 'Choose 山海之间 · 晚风' : '选择 山海之间 · 晚风',
        exact: true,
      })
      .click()
    await expect(page.locator('.mp-match-song-summary')).toContainText('山海之间')
    expect(await page.evaluate(() => JSON.stringify((window as any).partyTest.state))).toBe(before)
    const creationRequest = page.waitForRequest((request) => {
      if (!request.url().endsWith('/rpc') || request.method() !== 'POST') return false
      const data = request.postDataJSON()
      return data.name === 'call' && data.args[0]?.method === 'multiCreate'
    })
    await create.click()
    expect((await creationRequest).postDataJSON().args[0].args).toEqual({
      songId: '20',
      allowStrangerMatch: false,
    })
    await expect(
      page.getByRole('tab', { name: english ? 'Members' : '成员', exact: true }),
    ).toBeVisible()
  })
}
