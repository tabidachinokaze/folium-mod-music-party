import { parseStickerGroups, stickerKey, type SavedSticker } from '@party/shared/stickers'
import type { PartyController } from './controller'
import { button, el, picture } from './dom'
import { imageInput, uploadImage, type PrivateRun } from './private-tools'
import { mountDetailsPopup } from './popup-position'
import { t } from './i18n'
import { stickerCollectionRevision } from './sticker-collection'

// src/client/sticker-view.ts
export function createStickerPicker(
  controller: PartyController,
  send: (sticker: SavedSticker) => Promise<void>,
  scope: 'room' | 'private',
  run: PrivateRun = (task) => controller.run(task),
) {
  const box = el('details', 'mp-stickers')
  box.append(el('summary', '', t('表情包')))
  const content = el('div', 'mp-sticker-content mp-sticker-library'),
    header = el('header', 'mp-picker-header'),
    grid = el('div', 'mp-sticker-grid')
  const select = el('select')
  select.setAttribute('aria-label', t('表情分组'))
  let loaded = false,
    loadedRevision = -1,
    disposed = false,
    loading = false,
    mutating = false,
    epoch = 0,
    cursor = '',
    groupId = '',
    editing = false,
    hasMore = false,
    lastTop = 0
  const items = new Map<string, SavedSticker>(),
    selected = new Set<string>()
  const upload = imageInput(
    (file) =>
      void mutate(async () => {
        await uploadImage(controller, file, { kind: 'sticker' })
        await initialize()
      }),
  )
  const uploadButton = button(t('上传'), () => upload.click())
  uploadButton.setAttribute('aria-label', t('上传表情包'))
  const organize = button(t('整理'), () => {
    editing = true
    render()
  })
  const cancel = button(t('取消'), () => {
    editing = false
    selected.clear()
    render()
  })
  const remove = button(
    t('删除'),
    () =>
      void mutate(async () => {
        const ids = [...selected]
        if (!ids.length) return
        await controller.connection.attachment('removeStickers', ids)
        editing = false
        selected.clear()
        await initialize()
      }),
    'danger',
  )
  const status = el('p', 'mp-muted')
  header.append(el('strong', '', t('表情包')), uploadButton, organize, remove, cancel)
  content.append(header, select, status, grid, upload)
  box.append(content)
  const popup = mountDetailsPopup(box, content, { maxHeight: 'viewport' })
  async function mutate(task: () => Promise<unknown>) {
    if (mutating || disposed) return
    mutating = true
    render()
    try {
      await run(task)
    } finally {
      mutating = false
      if (!disposed) render()
    }
  }
  function render() {
    uploadButton.disabled =
      organize.disabled =
      cancel.disabled =
      remove.disabled =
        mutating || loading
    grid.inert = mutating || loading
    organize.hidden = editing
    cancel.hidden = !editing
    remove.hidden = !editing || !selected.size
    remove.textContent = t('删除 ({count})', { count: selected.size })
    select.disabled = editing || mutating || loading
    grid.replaceChildren(
      ...[...items].map(([key, item]) => {
        const pick = button('', () => {
          if (editing) {
            selected.has(item.emojiId) ? selected.delete(item.emojiId) : selected.add(item.emojiId)
            render()
            return
          }
          void run(async () => {
            await send(item)
            box.open = false
          })
        })
        pick.dataset.stickerKey = key
        pick.title = item.restricted ? t(item.restriction) : item.emojiName
        pick.setAttribute('aria-label', item.emojiName || t('发送表情'))
        if (editing) pick.setAttribute('aria-pressed', String(selected.has(item.emojiId)))
        pick.disabled = editing ? item.emojiId === '0' : item.restricted
        pick.append(picture(item.emojiImgUrl, item.emojiName))
        return pick
      }),
    )
    content.setAttribute('aria-busy', String(loading))
    status.textContent = loading
      ? t('正在加载表情…')
      : !items.size
        ? t('暂无表情包，可以上传图片或 GIF。')
        : editing
          ? t('选择要从网易云收藏中删除的表情包')
          : ''
    status.hidden = !status.textContent
  }
  async function load() {
    if (disposed || loading || !groupId || !hasMore) return
    const current = epoch
    loading = true
    render()
    try {
      const body = await controller.connection.call('stickerPage', {
        groupId,
        ...(cursor ? { cursor } : {}),
      })
      if (disposed || current !== epoch) return
      for (const item of body.data?.emojis || []) items.set(stickerKey(item), item)
      hasMore =
        body.data?.page?.more === true &&
        typeof body.data?.page?.cursor === 'string' &&
        !!body.data.page.cursor &&
        body.data.page.cursor !== cursor
      cursor = String(body.data?.page?.cursor || '')
      render()
    } finally {
      if (!disposed && current === epoch) {
        loading = false
        render()
        lastTop = content.scrollTop
      }
    }
  }
  async function initialize() {
    const current = ++epoch
    const revision = stickerCollectionRevision(controller)
    loaded = false
    loading = true
    cursor = ''
    hasMore = true
    content.scrollTop = lastTop = 0
    items.clear()
    selected.clear()
    render()
    let groups
    try {
      groups = parseStickerGroups(await controller.connection.call('stickerGroups', { scope }))
    } finally {
      if (!disposed && current === epoch) {
        loading = false
        render()
      }
    }
    if (disposed || current !== epoch) return
    select.replaceChildren(
      ...groups.map((group) => {
        const option = el('option', '', group.name)
        option.value = group.id
        return option
      }),
    )
    groupId = groups[0]?.id || ''
    select.hidden = groups.length < 2
    render()
    await load()
    if (!disposed && current === epoch) {
      loaded = true
      loadedRevision = revision
    }
  }
  select.addEventListener('change', () => {
    if (loading || mutating || editing) {
      select.value = groupId
      return
    }
    epoch++
    loading = false
    groupId = select.value
    cursor = ''
    hasMore = true
    content.scrollTop = lastTop = 0
    items.clear()
    selected.clear()
    void run(load)
  })
  const loadMore = () => {
    if (!box.open || !loaded || disposed || loading || mutating || editing || !hasMore) return
    if (content.scrollHeight - content.scrollTop - content.clientHeight < 48) void run(load)
  }
  content.addEventListener('scroll', () => {
    const top = content.scrollTop,
      down = top > lastTop
    lastTop = top
    if (down) loadMore()
  })
  content.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY > 0) loadMore()
    },
    { passive: true },
  )
  box.addEventListener('toggle', () => {
    if (
      box.open &&
      (!loaded || loadedRevision !== stickerCollectionRevision(controller)) &&
      !loading &&
      controller.state.account
    )
      void run(initialize)
  })
  let accountUid = controller.state.account?.uid
  const stopAccount = controller.subscribe(() => {
    if (accountUid === controller.state.account?.uid) return
    accountUid = controller.state.account?.uid
    epoch++
    loaded = loading = editing = hasMore = false
    cursor = ''
    groupId = ''
    items.clear()
    selected.clear()
    render()
    box.open = false
  })
  render()
  return {
    node: box,
    dispose() {
      disposed = true
      epoch++
      stopAccount()
      popup.dispose()
    },
  }
}
