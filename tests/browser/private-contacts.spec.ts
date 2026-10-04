import { expect, test } from '@playwright/test'

// tests/browser/private-contacts.spec.ts
test('loaded offscreen online peers sort first without replacing rows, moving the reading anchor or losing focus', async ({
  page,
  request,
}) => {
  await request.get('/test/reset')
  await page.addInitScript(() => {
    document.hasFocus = () => true
  })
  let release!: () => void,
    contactReads = 0
  const metadataReady = new Promise<void>((resolve) => {
      release = resolve
    }),
    queried = new Set<string>(),
    ids = Array.from({ length: 30 }, (_, index) => String(index + 10))
  await page.route('**/rpc', async (route) => {
    const body = route.request().postDataJSON()
    if (body.name === 'privatePeer') {
      const uid = String(body.args[0])
      queried.add(uid)
      await metadataReady
      return route.fulfill({
        json: {
          ok: true,
          result: {
            uid,
            nickname: `联系人 ${uid}`,
            avatar: '',
            online: uid === '12' || uid === '39' ? true : uid === '11' ? false : null,
          },
        },
      })
    }
    if (body.name === 'call' && body.args[0]?.method === 'privateConversations') {
      contactReads++
      return route.fulfill({
        json: {
          ok: true,
          result: {
            ok: true,
            data: {
              code: 200,
              more: false,
              msgs: ids.map((uid, index) => ({
                fromUser: { userId: Number(uid), nickname: `联系人 ${uid}`, avatarUrl: '' },
                toUser: { userId: 9 },
                lastMsg: '{"msg":"静态预览"}',
                lastMsgTime: 1790600000000 - index,
                newMsgCount: 0,
              })),
            },
          },
        },
      })
    }
    return route.fallback()
  })
  try {
    await page.goto('/')
    await page.getByRole('button', { name: '私信', exact: true }).click()
    const contacts = page.locator('.mp-private-home .mp-contacts'),
      rows = contacts.locator('.mp-contact'),
      focused = contacts.locator('[data-uid="20"]')
    await expect(rows).toHaveCount(30)
    await expect.poll(() => queried.size).toBe(2)
    expect(
      await rows.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.uid)),
    ).toEqual(ids)
    await contacts.evaluate((node) => {
      node.scrollTop = 360
      const rows = [...node.querySelectorAll<HTMLElement>('.mp-contact')]
      node.querySelector<HTMLButtonElement>('[data-uid="20"]')!.focus({ preventScroll: true })
      const top = node.getBoundingClientRect().top,
        anchor = rows.find((row) => row.getBoundingClientRect().bottom > top + 1)!
      ;(window as any).privateContactSnapshot = {
        nodes: new Map(rows.map((row) => [row.dataset.uid, row])),
        anchor,
        offset: anchor.getBoundingClientRect().top - top,
      }
    })
    release()
    await expect.poll(() => queried.size).toBe(30)
    await expect
      .poll(() =>
        rows.evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.uid)),
      )
      .toEqual(['12', '39', ...ids.filter((uid) => uid !== '12' && uid !== '39')])
    await expect(focused).toBeFocused()
    await expect(contacts.locator('[data-uid="39"] .mp-presence-dot')).toHaveCount(1)
    await expect(contacts.locator('[data-uid="10"] .mp-presence-dot')).toHaveCount(0)
    await expect(contacts.locator('[data-uid="11"] .mp-presence-dot')).toHaveCount(0)
    const stable = () =>
      contacts.evaluate((node) => {
        const saved = (window as any).privateContactSnapshot
        return {
          sameNodes: [...node.querySelectorAll<HTMLElement>('.mp-contact')].every(
            (row) => saved.nodes.get(row.dataset.uid) === row,
          ),
          anchorError: Math.abs(
            saved.anchor.getBoundingClientRect().top -
              node.getBoundingClientRect().top -
              saved.offset,
          ),
        }
      })
    expect((await stable()).sameNodes).toBe(true)
    expect((await stable()).anchorError).toBeLessThanOrEqual(1)
    const before = contactReads
    // Exercise the unchanged-response fallback refresh, without a manual focus or refresh event.
    await expect.poll(() => contactReads, { timeout: 14000 }).toBeGreaterThan(before)
    await expect(focused).toBeFocused()
    expect((await stable()).sameNodes).toBe(true)
    expect((await stable()).anchorError).toBeLessThanOrEqual(1)
    expect(queried.size).toBe(30)
  } finally {
    release()
  }
})
