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
  await expect(page.getByRole('button', { name: '用当前歌曲创建', exact: true })).toBeEnabled()
  await expect(resume).toBeHidden()
  const before = await page.evaluate(() => ({ ...(window as any).partyTest.state }))
  await page.getByRole('button', { name: '用当前歌曲创建', exact: true }).click()
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
