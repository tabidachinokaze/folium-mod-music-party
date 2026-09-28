import { parseStickerGroups, stickerKey, type SavedSticker } from '@party/shared/stickers'
import type { PartyController } from './controller'
import { button, el, picture } from './dom'

// src/client/sticker-view.ts
export function createStickerPicker(
  controller: PartyController,
  send: (sticker: SavedSticker) => Promise<void>,
  scope: 'room' | 'private',
) {
  const box = el('details', 'mp-stickers')
  box.append(el('summary', '', '表情'))
  const content = el('div', 'mp-sticker-content')
  box.append(content)
  let loaded = false,
    disposed = false,
    cursor = '',
    groupId = ''
  let known = new Set<string>()
  const grid = el('div', 'mp-sticker-grid')
  const more = button('加载更多表情', () => void controller.run(load))
  async function load() {
    const body = await controller.connection.call('stickerPage', {
      groupId,
      ...(cursor ? { cursor } : {}),
    })
    if (disposed) return
    for (const item of body.data?.emojis || []) {
      const key = stickerKey(item)
      if (known.has(key)) continue
      known.add(key)
      const pick = button(
        '',
        () =>
          void controller.run(async () => {
            await send(item)
            box.open = false
          }),
      )
      pick.title = item.restricted ? item.restriction : item.emojiName
      pick.setAttribute('aria-label', item.emojiName || '发送表情')
      pick.disabled = item.restricted
      pick.append(picture(item.emojiImgUrl, item.emojiName))
      grid.append(pick)
    }
    more.hidden =
      body.data?.page?.more !== true || !body.data?.page?.cursor || body.data.page.cursor === cursor
    cursor = String(body.data?.page?.cursor || '')
  }
  box.addEventListener('toggle', () => {
    if (!box.open || loaded || !controller.state.account) return
    void controller.run(async () => {
      const groups = parseStickerGroups(
        await controller.connection.call('stickerGroups', { scope }),
      )
      if (disposed) return
      content.replaceChildren()
      if (!groups.length) {
        content.append(el('p', 'mp-muted', '暂无自定义表情，请先在网易云 App 收藏表情。'))
        loaded = true
        return
      }
      const select = el('select')
      select.setAttribute('aria-label', '表情分组')
      groups.forEach((group) => {
        const option = el('option', '', group.name)
        option.value = group.id
        select.append(option)
      })
      groupId = groups[0].id
      select.addEventListener('change', () => {
        groupId = select.value
        cursor = ''
        known = new Set()
        grid.replaceChildren()
        void controller.run(load)
      })
      content.append(select, grid, more)
      await load()
      loaded = true
    })
  })
  let accountUid = controller.state.account?.uid
  const stopAccount = controller.subscribe(() => {
    if (accountUid === controller.state.account?.uid) return
    accountUid = controller.state.account?.uid
    loaded = false
    cursor = ''
    groupId = ''
    known.clear()
    grid.replaceChildren()
    content.replaceChildren()
    box.open = false
  })
  const outside = (event: PointerEvent) => {
    if (!event.composedPath().includes(box)) box.open = false
  }
  document.addEventListener('pointerdown', outside)
  return {
    node: box,
    dispose() {
      disposed = true
      stopAccount()
      document.removeEventListener('pointerdown', outside)
    },
  }
}
