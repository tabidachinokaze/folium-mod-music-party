import { expect, test, type Locator, type Page } from '@playwright/test'

// tests/browser/sticker-cache.spec.ts
const key = (index: number, group = '1', uid = 9) =>
  String(uid * 1000 + (group === '2' ? 500 : 0) + index)
const sticker = (index: number, group = '1', uid = 9) => ({
  emojiId: key(index, group, uid),
  emojiGroupId: group,
  emojiName: `账号${uid} 表情${index}`,
  emojiImgUrl: `https://p1.music.126.net/fixture/cache-${key(index, group, uid)}.gif`,
  width: 100,
  height: 100,
  format: 'gif',
  picId: key(index, group, uid),
  restricted: false,
  restriction: '',
})

async function mockLibrary(page: Page) {
  const state = {
    uid: 9,
    groups: 0,
    pages: [] as { uid: number; group: string; cursor: string }[],
    completed: [] as number[],
    removed: new Set<string>(),
    deleted: [] as string[][],
    failDelete: false,
    uploads: 0,
    added: false,
    bulkAdded: 0,
    failCursor: '',
    hold: false,
  }
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('https://p1.music.126.net/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
    }),
  )
  await page.route('**/rpc', async (route) => {
    const payload = route.request().postDataJSON()
    const method = payload.name === 'call' ? payload.args[0]?.method : ''
    const reply = (data: unknown) =>
      route.fulfill({ json: { ok: true, result: { ok: true, data: { code: 200, data } } } })
    if (method === 'account')
      return reply({ profile: { userId: state.uid, nickname: `账号${state.uid}` } })
    if (method === 'stickerGroups') {
      state.groups++
      return reply({
        emojiGroups: [
          { id: '1', name: '我的表情', edit: true },
          { id: '2', name: '其他表情', edit: true },
        ],
      })
    }
    if (method === 'stickerPage') {
      const args = payload.args[0].args,
        uid = state.uid,
        group = String(args.groupId),
        cursor = String(args.cursor || '')
      state.pages.push({ uid, group, cursor })
      if (cursor && cursor === state.failCursor) {
        state.failCursor = ''
        return route.fulfill({ json: { ok: false, error: '模拟补页失败' } })
      }
      const start = cursor === 'page-2' ? 33 : cursor === 'page-3' ? 65 : 1
      let emojis = Array.from(
        { length: group === '2' ? 8 : cursor === 'page-3' ? 16 : 32 },
        (_, index) => sticker(start + index, group, uid),
      )
      let pagination = {
        more: group === '1' && cursor !== 'page-3',
        cursor: group === '2' || cursor === 'page-3' ? '' : cursor ? 'page-3' : 'page-2',
      }
      if (state.added && group === '1' && !cursor)
        emojis = [sticker(999, group, uid), ...emojis.slice(0, 31)]
      if (
        state.added &&
        state.bulkAdded > 0 &&
        group === '1' &&
        (!cursor || cursor.startsWith('fresh-'))
      ) {
        const all = [
          ...Array.from({ length: state.bulkAdded }, (_, index) =>
            sticker(999 + index, group, uid),
          ),
          ...Array.from({ length: 80 }, (_, index) => sticker(index + 1, group, uid)),
        ]
        const segment = cursor ? Number(cursor.slice('fresh-'.length)) : 1
        emojis = all.slice((segment - 1) * 32, segment * 32)
        pagination = {
          more: segment * 32 < all.length,
          cursor: segment * 32 < all.length ? `fresh-${segment + 1}` : '',
        }
      }
      emojis = emojis.filter((item) => !state.removed.has(item.emojiId))
      if (state.hold) {
        state.hold = false
        await held
      }
      await reply({
        emojis,
        page: pagination,
      })
      state.completed.push(uid)
      return
    }
    if (payload.name === 'removeStickers') {
      const ids = payload.args[0] as string[]
      state.deleted.push(ids)
      if (state.failDelete) {
        state.failDelete = false
        return route.fulfill({ json: { ok: false, error: '模拟删除失败' } })
      }
      ids.forEach((id) => state.removed.add(id))
      return route.fulfill({ json: { ok: true, result: true } })
    }
    if (payload.name === 'media') {
      expect(payload.args[0].target).toEqual({ kind: 'sticker' })
      state.uploads++
      state.added = true
      return route.fulfill({
        json: { ok: true, result: { ok: true, receipt: { emoji: sticker(999) } } },
      })
    }
    return route.continue()
  })
  return { state, release }
}

async function roomLibrary(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  const chat = page.locator('.mp-chat-view')
  await chat.locator('summary[aria-label="表情包"]').click()
  return chat.locator('.mp-sticker-library')
}
async function loadSecondPage(library: Locator) {
  await expect(library.locator('[data-sticker-key]')).toHaveCount(32)
  const list = library.locator('.mp-sticker-scroll')
  await list.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await list.dispatchEvent('wheel', { deltaY: 120 })
  await expect(library.locator('[data-sticker-key]')).toHaveCount(64)
  await list.evaluate((node) => {
    node.scrollTop = 280
  })
}
const item = (library: Locator, index: number, group = '1', uid = 9) =>
  library.locator(`[data-sticker-key="${key(index, group, uid)}"]`)
async function offset(library: Locator, index: number) {
  const bounds = (await item(library, index).boundingBox())!,
    list = (await library.locator('.mp-sticker-scroll').boundingBox())!
  return bounds.y - list.y
}
async function selectForRemoval(library: Locator, index: number) {
  await library.getByRole('button', { name: '整理', exact: true }).click()
  await item(library, index).click()
}

test.beforeEach(async ({ request, page }) => {
  await request.get('/test/reset')
  await page.setViewportSize({ width: 1000, height: 740 })
})

test('deleting one sticker keeps loaded image nodes, reading position and the next-page cursor', async ({
  page,
}) => {
  const { state } = await mockLibrary(page)
  const library = await roomLibrary(page)
  await loadSecondPage(library)
  const retained = await item(library, 21).locator('img').elementHandle()
  await selectForRemoval(library, 25)
  const before = {
    groups: state.groups,
    pages: state.pages.length,
    offset: await offset(library, 21),
    top: await library.locator('.mp-sticker-scroll').evaluate((node) => node.scrollTop),
  }
  await library.getByRole('button', { name: '删除 (1)', exact: true }).click()
  await expect(item(library, 25)).toHaveCount(0)
  await expect(library.locator('[data-sticker-key]')).toHaveCount(63)
  expect(
    await item(library, 21)
      .locator('img')
      .evaluate((node, previous) => node.isSameNode(previous), retained),
  ).toBe(true)
  expect(Math.abs((await offset(library, 21)) - before.offset)).toBeLessThan(2)
  expect(
    await library.locator('.mp-sticker-scroll').evaluate((node) => node.scrollTop),
  ).toBeGreaterThan(200)
  expect(state.groups).toBe(before.groups)
  expect(state.pages).toHaveLength(before.pages)
  expect(state.deleted).toEqual([[key(25)]])
  await library.locator('.mp-sticker-scroll').evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await library.locator('.mp-sticker-scroll').dispatchEvent('wheel', { deltaY: 120 })
  await expect(library.locator('[data-sticker-key]')).toHaveCount(79)
  expect(state.pages.map((page) => page.cursor)).toEqual(['', 'page-2', 'page-3'])
})

test('a failed delete keeps selection, then successful deletion updates already loaded room and private libraries', async ({
  page,
}) => {
  const { state } = await mockLibrary(page)
  const room = await roomLibrary(page)
  await loadSecondPage(room)
  const retained = await item(room, 21).locator('img').elementHandle()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const home = page.locator('.mp-private-home')
  await home.locator('summary').filter({ hasText: '表情包' }).click()
  const library = home.locator('.mp-sticker-library')
  await loadSecondPage(library)
  await selectForRemoval(library, 25)
  state.failDelete = true
  const before = { groups: state.groups, pages: state.pages.length }
  await library.getByRole('button', { name: '删除 (1)', exact: true }).click()
  await expect(page.locator('[data-host-toast=error]')).toContainText('模拟删除失败')
  await expect(item(library, 25)).toHaveAttribute('aria-pressed', 'true')
  await expect(library.locator('[data-sticker-key]')).toHaveCount(64)
  await expect(room.locator('[data-sticker-key]')).toHaveCount(64)
  await library.getByRole('button', { name: '删除 (1)', exact: true }).click()
  await expect(item(library, 25)).toHaveCount(0)
  await expect(item(room, 25)).toHaveCount(0)
  expect(
    await item(room, 21)
      .locator('img')
      .evaluate((node, previous) => node.isSameNode(previous), retained),
  ).toBe(true)
  expect(state.groups).toBe(before.groups)
  expect(state.pages).toHaveLength(before.pages)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '一起听', exact: true }).click()
  await page.locator('.mp-chat-view summary[aria-label="表情包"]').click()
  await expect(room.locator('[data-sticker-key]')).toHaveCount(63)
  expect(state.pages).toHaveLength(before.pages)
})

test('upload merges the first page without losing the tail or nodes, and group switches restore cached positions', async ({
  page,
}) => {
  const { state } = await mockLibrary(page)
  const library = await roomLibrary(page)
  await loadSecondPage(library)
  const retained = await item(library, 21).locator('img').elementHandle()
  const before = {
    pages: state.pages.length,
    offset: await offset(library, 21),
    top: await library.locator('.mp-sticker-scroll').evaluate((node) => node.scrollTop),
  }
  await library.locator('input[type=file]').setInputFiles({
    name: 'new.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
  })
  await expect.poll(() => state.uploads).toBe(1)
  await expect(item(library, 999)).toHaveCount(1)
  await expect(library.locator('[data-sticker-key]')).toHaveCount(65)
  await expect(item(library, 64)).toHaveCount(1)
  expect(state.pages.slice(before.pages).map((page) => page.cursor)).toEqual([''])
  expect(
    await item(library, 21)
      .locator('img')
      .evaluate((node, previous) => node.isSameNode(previous), retained),
  ).toBe(true)
  expect(Math.abs((await offset(library, 21)) - before.offset)).toBeLessThan(2)
  await library.getByRole('combobox', { name: '表情分组' }).selectOption('2')
  await expect(library.locator('[data-sticker-key]')).toHaveCount(8)
  const calls = state.pages.length
  await library.getByRole('combobox', { name: '表情分组' }).selectOption('1')
  await expect(library.locator('[data-sticker-key]')).toHaveCount(65)
  expect(state.pages).toHaveLength(calls)
  expect(
    await item(library, 21)
      .locator('img')
      .evaluate((node, previous) => node.isSameNode(previous), retained),
  ).toBe(true)
  expect(Math.abs((await offset(library, 21)) - before.offset)).toBeLessThan(2)
})

test('a late page from the old account cannot populate the newly signed-in account library', async ({
  page,
}) => {
  const { state, release } = await mockLibrary(page)
  state.hold = true
  const old = await roomLibrary(page)
  const oldNode = await old.elementHandle()
  await expect.poll(() => state.pages.length).toBe(1)
  state.uid = 42
  await page.evaluate(() => {
    localStorage.setItem('online_provider:netease:cookie', 'MUSIC_U=another-test-account')
    window.dispatchEvent(new Event('storage'))
  })
  await expect.poll(() => oldNode!.evaluate((node) => node.isConnected)).toBe(false)
  await page.getByRole('button', { name: '恢复当前房间', exact: true }).click()
  await page.getByRole('tab', { name: '聊天', exact: true }).click()
  await page.locator('.mp-chat-view summary[aria-label="表情包"]').click()
  const fresh = page.locator('.mp-chat-view .mp-sticker-library')
  await expect(item(fresh, 1, '1', 42)).toBeVisible()
  release()
  await expect.poll(() => state.completed.includes(9)).toBe(true)
  await expect(fresh.locator('[data-sticker-key]')).toHaveCount(32)
  await expect(item(fresh, 1)).toHaveCount(0)
  expect(state.pages.map((page) => page.uid)).toEqual([9, 42])
})

for (const failOnce of [false, true])
  test(`reopening a fully cached library fills a multi-page new prefix without rereading the tail; retry=${failOnce}`, async ({
    page,
  }) => {
    const { state } = await mockLibrary(page)
    const room = await roomLibrary(page)
    await loadSecondPage(room)
    const list = room.locator('.mp-sticker-scroll')
    await list.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await list.dispatchEvent('wheel', { deltaY: 120 })
    await expect(room.locator('[data-sticker-key]')).toHaveCount(80)
    await list.evaluate((node) => {
      node.scrollTop = 280
    })
    const retained = await item(room, 21).locator('img').elementHandle(),
      anchor = await offset(room, 21)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '私信', exact: true }).click()
    await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
    const home = page.locator('.mp-private-home')
    await home.locator('summary').filter({ hasText: '表情包' }).click()
    const library = home.locator('.mp-sticker-library')
    await expect(library.locator('[data-sticker-key]')).toHaveCount(32)
    // One local upload discovers a batch of other additions made while the room picker was closed.
    state.bulkAdded = 65
    await library.locator('input[type=file]').setInputFiles({
      name: 'new.gif',
      mimeType: 'image/gif',
      buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
    })
    await expect(item(library, 1063)).toHaveCount(1)
    await expect(library).toHaveAttribute('aria-busy', 'false')
    await page.keyboard.press('Escape')
    await expect(room.locator('[data-sticker-key]')).toHaveCount(80)
    const before = state.pages.length
    if (failOnce) state.failCursor = 'fresh-2'
    await page.getByRole('button', { name: '一起听', exact: true }).click()
    await page.locator('.mp-chat-view summary[aria-label="表情包"]').click()
    if (failOnce) {
      await expect(page.locator('[data-host-toast=error]')).toContainText('模拟补页失败')
      await expect(room.locator('[data-sticker-key]')).toHaveCount(80)
      expect(
        await item(room, 21)
          .locator('img')
          .evaluate((node, previous) => node.isSameNode(previous), retained),
      ).toBe(true)
      expect(Math.abs((await offset(room, 21)) - anchor)).toBeLessThan(2)
      expect(state.pages.slice(before).map((page) => page.cursor)).toEqual(['', 'fresh-2'])
      await page.keyboard.press('Escape')
      await page.locator('.mp-chat-view summary[aria-label="表情包"]').click()
    }
    await expect(room.locator('[data-sticker-key]')).toHaveCount(145)
    expect(
      await room
        .locator('[data-sticker-key]')
        .evaluateAll(
          (nodes) => new Set(nodes.map((node) => (node as HTMLElement).dataset.stickerKey)).size,
        ),
    ).toBe(145)
    await expect(item(room, 1063)).toHaveCount(1)
    await expect(item(room, 80)).toHaveCount(1)
    expect(
      await item(room, 21)
        .locator('img')
        .evaluate((node, previous) => node.isSameNode(previous), retained),
    ).toBe(true)
    expect(Math.abs((await offset(room, 21)) - anchor)).toBeLessThan(2)
    const expected = failOnce
      ? ['', 'fresh-2', '', 'fresh-2', 'fresh-3']
      : ['', 'fresh-2', 'fresh-3']
    expect(state.pages.slice(before).map((page) => page.cursor)).toEqual(expected)
    // The old group was complete. A downward wheel must not fetch any known old-tail page.
    await list.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await list.dispatchEvent('wheel', { deltaY: 120 })
    expect(state.pages.slice(before).map((page) => page.cursor)).toEqual(expected)
  })

test('a page already in flight cannot resurrect a sticker deleted from the other view', async ({
  page,
}) => {
  const { state, release } = await mockLibrary(page)
  const room = await roomLibrary(page)
  await loadSecondPage(room)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '私信', exact: true }).click()
  await page.getByRole('button', { name: '小岛 · 1 未读', exact: true }).click()
  const home = page.locator('.mp-private-home')
  state.hold = true
  await home.locator('summary').filter({ hasText: '表情包' }).click()
  await expect.poll(() => state.pages.length).toBe(3)
  const library = home.locator('.mp-sticker-library')
  await expect(library).toHaveAttribute('aria-busy', 'true')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '一起听', exact: true }).click()
  await page.locator('.mp-chat-view summary[aria-label="表情包"]').click()
  await selectForRemoval(room, 25)
  await room.getByRole('button', { name: '删除 (1)', exact: true }).click()
  await expect(item(room, 25)).toHaveCount(0)
  release()
  await expect.poll(() => state.completed.length).toBe(3)
  await expect(library.locator('[data-sticker-key]')).toHaveCount(31)
  await expect(item(library, 25)).toHaveCount(0)
  await expect(room.locator('[data-sticker-key]')).toHaveCount(63)
  expect(state.pages).toHaveLength(3)
})
