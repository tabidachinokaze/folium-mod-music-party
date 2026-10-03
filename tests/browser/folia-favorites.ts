import { expect, type APIRequestContext, type Page } from '@playwright/test'

// tests/browser/folia-favorites.ts
// Personal collections and official room hearts are different requests. This probe keeps both
// on local fixtures and controls the former's response to test their ordering through real UI.
export async function installFavoriteProbe(page: Page, request: APIRequestContext) {
  const personal: { songId: string | null; liked: boolean }[] = []
  const personalLiked = new Set<number>()
  let nextReply: { code: number; wait?: Promise<void> } | undefined
  const isLocalPath = (url: URL, path: string) =>
    ['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname === path
  const cors = (origin: string | undefined) => ({
    'access-control-allow-origin': origin || '*',
    'access-control-allow-credentials': 'true',
  })
  await page.route(
    (url) => isLocalPath(url, '/likelist'),
    (route) =>
      route.fulfill({
        headers: cors(route.request().headers().origin),
        json: { code: 200, ids: [...personalLiked] },
      }),
  )
  await page.route(
    (url) => isLocalPath(url, '/like'),
    async (route) => {
      const url = new URL(route.request().url())
      const reply = nextReply ?? { code: 200 }
      nextReply = undefined
      personal.push({
        songId: url.searchParams.get('id'),
        liked: url.searchParams.get('like') === 'true',
      })
      await reply.wait
      if (reply.code === 200) {
        const id = Number(url.searchParams.get('id'))
        if (url.searchParams.get('like') === 'true') personalLiked.add(id)
        else personalLiked.delete(id)
      }
      await route.fulfill({
        headers: cors(route.request().headers().origin),
        json: { code: reply.code },
      })
    },
  )
  const roomHearts = async () => {
    const state = await (await request.get('/test/state')).json()
    return state.operations.filter((operation: { operate: number }) => operation.operate === 5)
  }
  const heart = page.locator('[data-ponder="player-bar"] [data-ponder-slot="like"]')
  const icon = heart.locator('svg')
  async function withoutSidebar(action: () => Promise<void>) {
    const panel = page.getByTestId('unified-panel-surface')
    const wasOpen = await panel.isVisible()
    if (wasOpen) {
      await page.getByTestId('panel-toggle').getByRole('button').click()
      await expect(panel).toHaveCount(0)
    }
    try {
      await action()
    } finally {
      if (wasOpen) {
        await page.getByTestId('panel-toggle').getByRole('button').click()
        await expect(panel).toBeVisible()
      }
    }
  }
  async function clickFavorite(songId: string, likedBefore: boolean) {
    await expect
      .poll(() => page.evaluate(() => (window as any).partyHost.api.playback.getState().song?.id))
      .toBe(songId)
    await page.locator('[data-ponder="player-bar"]').hover()
    await expect(icon).toHaveAttribute('fill', likedBefore ? 'currentColor' : 'none')
    await heart.click()
  }
  return {
    verifyRoomFavorite: () =>
      withoutSidebar(async () => {
        const before = await roomHearts()
        nextReply = { code: 500 }
        await clickFavorite('1', false)
        await expect(page.getByText('添加失败', { exact: true })).toBeVisible()
        expect(personal).toEqual([{ songId: '1', liked: true }])
        await expect(icon).toHaveAttribute('fill', 'none')
        expect(await roomHearts()).toEqual(before)

        let finishPersonal!: () => void
        nextReply = {
          code: 200,
          wait: new Promise<void>((resolve) => {
            finishPersonal = resolve
          }),
        }
        await clickFavorite('1', false)
        try {
          await expect.poll(() => personal.length).toBe(2)
          expect(await roomHearts()).toEqual(before)
          await expect(icon).toHaveAttribute('fill', 'none')
        } finally {
          finishPersonal()
        }
        await expect(icon).toHaveAttribute('fill', 'currentColor')
        await expect.poll(async () => (await roomHearts()).length).toBe(before.length + 1)
        expect((await roomHearts()).at(-1)).toMatchObject({
          roomId: 'official_room',
          songId: '1',
          bizId: '101',
          operate: 5,
        })

        await clickFavorite('1', true)
        await expect(icon).toHaveAttribute('fill', 'none')
        expect(personal.at(-1)).toEqual({ songId: '1', liked: false })
        expect((await roomHearts()).length).toBe(before.length + 1)
      }),
    async verifyPersonalOnly(songId: string, remote?: Page) {
      const verify = async () => {
        const before = await roomHearts()
        const personalBefore = personal.length
        if (remote) {
          await expect
            .poll(() =>
              page.evaluate(() => (window as any).partyHost.api.playback.getState().song?.id),
            )
            .toBe(songId)
          const remoteHeart = remote.locator('button:has(svg.lucide-heart)')
          await remote.mouse.move(180, 310)
          await expect(remoteHeart.locator('svg')).toHaveAttribute('fill', 'none')
          await remoteHeart.click()
          await expect(remoteHeart.locator('svg')).toHaveAttribute('fill', 'currentColor')
        } else {
          await clickFavorite(songId, false)
          await expect(icon).toHaveAttribute('fill', 'currentColor')
        }
        expect(personal.slice(personalBefore)).toEqual([{ songId, liked: true }])
        expect(await roomHearts()).toEqual(before)
      }
      if (remote) await verify()
      else await withoutSidebar(verify)
    },
  }
}
