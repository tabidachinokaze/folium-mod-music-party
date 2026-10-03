import { parseStickerGroups, stickerKey, type SavedSticker } from '@party/shared/stickers'
import { mediaUrl } from '@party/shared/message-content'
import type { PartyController } from './controller'
import { button, el, picture } from './dom'
import { imageInput, uploadImage, type PrivateRun } from './private-tools'
import { mountDetailsPopup } from './popup-position'
import { t } from './i18n'
import {
  forgetSavedStickers,
  rememberSavedSticker,
  stickerCollectionChanged,
  stickerCollectionRevision,
  subscribeStickerCollection,
} from './sticker-collection'

// src/client/sticker-view.ts
type ScrollPosition = { top: number; anchors: { key: string; offset: number }[] }
type StickerNode = { button: HTMLButtonElement; image: HTMLImageElement; url: string }
type GroupCache = {
  id: string
  items: Map<string, SavedSticker>
  nodes: Map<string, StickerNode>
  cursor: string
  hasMore: boolean
  loaded: boolean
  dirtyRevision: number
  syncedRevision: number
  pending: Promise<void> | null
  scroll: ScrollPosition
}

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
    list = el('div', 'mp-sticker-scroll'),
    grid = el('div', 'mp-sticker-grid')
  const select = el('select')
  select.setAttribute('aria-label', t('表情分组'))
  let disposed = false,
    mutating = false,
    epoch = 0,
    groupId = '',
    editing = false,
    lastTop = 0,
    accountUid = controller.state.account?.uid,
    groupsLoaded = false,
    groupsDirtyRevision = 0,
    groupsSyncedRevision = -1,
    groupsPending: Promise<void> | null = null,
    refreshPending: Promise<void> | null = null,
    renderedGroup: GroupCache | undefined
  const groups = new Map<string, GroupCache>(),
    removedAt = new Map<string, number>(),
    selected = new Set<string>()
  const activeGroup = () => groups.get(groupId)
  const currentRequest = () => {
    const uid = accountUid,
      generation = epoch
    return () => !disposed && !!uid && uid === controller.state.account?.uid && generation === epoch
  }
  const upload = imageInput(
    (file) =>
      void mutate(async (current) => {
        const result = await uploadImage(controller, file, { kind: 'sticker' }, current)
        if (!current()) return
        if (result?.receipt?.emoji) rememberSavedSticker(controller, result.receipt.emoji)
        stickerCollectionChanged(controller)
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
      void mutate(async (current) => {
        const ids = [...selected]
        if (!ids.length) return
        await controller.connection.attachment('removeStickers', ids)
        if (!current()) return
        forgetSavedStickers(controller, ids)
        editing = false
        selected.clear()
      }),
    'danger',
  )
  const status = el('p', 'mp-muted')
  header.append(el('strong', '', t('表情包')), uploadButton, organize, remove, cancel)
  list.append(grid)
  content.append(header, select, status, list, upload)
  box.append(content)
  const popup = mountDetailsPopup(box, content, { maxHeight: 'viewport' })

  async function mutate(task: (current: () => boolean) => Promise<unknown>) {
    if (mutating || disposed) return
    const current = currentRequest()
    if (!current()) return
    mutating = true
    render()
    try {
      await run(async () => {
        if (!current()) return
        try {
          await task(current)
        } catch (error) {
          if (current()) throw error
        }
      })
    } finally {
      if (current()) {
        mutating = false
        render()
      }
    }
  }
  // Background reads must not be dropped by the room's global mutation/busy guard.
  async function read(task: () => Promise<void>) {
    const current = currentRequest()
    if (!current()) return
    try {
      await task()
    } catch (error) {
      if (!current()) return
      controller.handleAccountError(error as { code?: number })
      controller.notify(error instanceof Error ? error.message : t('操作失败，请重试'), 'error')
    }
  }
  function cache(id: string) {
    let group = groups.get(id)
    if (!group) {
      group = {
        id,
        items: new Map(),
        nodes: new Map(),
        cursor: '',
        hasMore: true,
        loaded: false,
        dirtyRevision: 0,
        syncedRevision: -1,
        pending: null,
        scroll: { top: 0, anchors: [] },
      }
      groups.set(id, group)
    }
    return group
  }
  function captureScroll(): ScrollPosition {
    const bounds = list.getBoundingClientRect(),
      anchors: ScrollPosition['anchors'] = []
    for (const child of grid.children) {
      const node = child as HTMLElement,
        rect = node.getBoundingClientRect()
      if (rect.bottom <= bounds.top) continue
      if (rect.top >= bounds.bottom && anchors.length) break
      anchors.push({ key: node.dataset.stickerKey!, offset: rect.top - bounds.top })
    }
    return { top: list.scrollTop, anchors }
  }
  function restoreScroll(position: ScrollPosition, group: GroupCache) {
    list.scrollTop = position.top
    for (const anchor of position.anchors) {
      const node = group.nodes.get(anchor.key)?.button
      if (!group.items.has(anchor.key) || node?.parentNode !== grid) continue
      list.scrollTop +=
        node.getBoundingClientRect().top - list.getBoundingClientRect().top - anchor.offset
      break
    }
    lastTop = list.scrollTop
    group.scroll = captureScroll()
  }
  function stickerNode(group: GroupCache, key: string, item: SavedSticker) {
    let node = group.nodes.get(key)
    if (!node) {
      const pick = button('', () => {
        const latest = group.items.get(key)
        if (!latest || group !== activeGroup()) return
        if (editing) {
          selected.has(latest.emojiId)
            ? selected.delete(latest.emojiId)
            : selected.add(latest.emojiId)
          render()
          return
        }
        const current = currentRequest()
        void run(async () => {
          if (!current()) return
          try {
            await send(latest)
            if (current() && group === activeGroup()) box.open = false
          } catch (error) {
            if (current()) throw error
          }
        })
      })
      pick.dataset.stickerKey = key
      const image = picture(item.emojiImgUrl, item.emojiName)
      pick.append(image)
      node = { button: pick, image, url: item.emojiImgUrl }
      group.nodes.set(key, node)
    }
    node.button.title = item.restricted ? t(item.restriction) : item.emojiName
    node.button.setAttribute('aria-label', item.emojiName || t('发送表情'))
    if (editing) node.button.setAttribute('aria-pressed', String(selected.has(item.emojiId)))
    else node.button.removeAttribute('aria-pressed')
    node.button.disabled = editing ? item.emojiId === '0' : item.restricted
    node.image.alt = item.emojiName
    if (node.url !== item.emojiImgUrl) {
      const safe = mediaUrl(item.emojiImgUrl)
      if (safe) node.image.src = safe
      else node.image.removeAttribute('src')
      node.image.hidden = !safe
      node.url = item.emojiImgUrl
    }
    return node.button
  }
  function render(restoreSaved = false) {
    const group = activeGroup(),
      visible = box.open && content.matches(':popover-open'),
      position =
        group &&
        (restoreSaved || renderedGroup !== group || !visible ? group.scroll : captureScroll()),
      loading = !!groupsPending || !!group?.pending
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
    const buttons = [...(group?.items || [])].map(([key, item]) => stickerNode(group!, key, item)),
      retained = new Set(buttons)
    for (const child of [...grid.children])
      if (!retained.has(child as HTMLButtonElement)) child.remove()
    let next: ChildNode | null = grid.firstChild
    for (const pick of buttons) {
      if (pick !== next) grid.insertBefore(pick, next)
      next = pick.nextSibling
    }
    renderedGroup = group
    content.setAttribute('aria-busy', String(loading))
    status.textContent = loading
      ? t('正在加载表情…')
      : !group?.items.size
        ? t('暂无表情包，可以上传图片或 GIF。')
        : editing
          ? t('选择要从网易云收藏中删除的表情包')
          : ''
    status.hidden = !status.textContent
    if (visible && group && position) restoreScroll(position, group)
  }
  async function loadPage(group: GroupCache, refresh = false) {
    if (group.pending) return group.pending
    if (!refresh && group.loaded && !group.hasMore) return
    const current = currentRequest(),
      revision = stickerCollectionRevision(controller),
      firstPage = refresh || !group.loaded,
      refreshing = refresh && group.loaded,
      knownKeys = new Set(group.items.keys())
    const operation = (async () => {
      const incoming = new Map<string, SavedSticker>(),
        seenCursors = new Set<string>()
      let requestCursor = firstPage ? '' : group.cursor,
        nextCursor = '',
        more = false,
        reachedKnown = false
      do {
        seenCursors.add(requestCursor)
        const body = await controller.connection.call('stickerPage', {
          groupId: group.id,
          ...(requestCursor ? { cursor: requestCursor } : {}),
        })
        if (!current() || groups.get(group.id) !== group) return
        more = body.data?.page?.more === true
        nextCursor = typeof body.data?.page?.cursor === 'string' ? body.data.page.cursor : ''
        if (
          !Array.isArray(body.data?.emojis) ||
          (more && (!nextCursor || seenCursors.has(nextCursor)))
        )
          throw new Error(t('自定义表情响应异常，请重试'))
        for (const item of body.data.emojis) {
          // Every prefix page belongs to the same refresh revision. Later deletes
          // also filter entries buffered by an earlier page before the final merge.
          if ((removedAt.get(item.emojiId) ?? -1) > revision) continue
          const key = stickerKey(item)
          incoming.set(key, item)
          rememberSavedSticker(controller, item)
          if (knownKeys.has(key) && group.items.has(key)) reachedKnown = true
        }
        requestCursor = nextCursor
        // Follow only the unknown prefix; the existing tail keeps its own opaque cursor.
      } while (refreshing && knownKeys.size > 0 && more && !reachedKnown)
      for (const [key, item] of incoming) {
        if ((removedAt.get(item.emojiId) ?? -1) > revision) incoming.delete(key)
      }
      if (refreshing) {
        group.items = new Map([
          ...incoming,
          ...[...group.items].filter(([key]) => !incoming.has(key)),
        ])
      } else {
        for (const [key, item] of incoming) group.items.set(key, item)
      }
      if (!refreshing || !reachedKnown) {
        group.hasMore = more
        group.cursor = nextCursor
      }
      group.loaded = true
      if (firstPage) group.syncedRevision = revision
    })()
    group.pending = operation
    render()
    try {
      await operation
    } finally {
      if (current()) {
        group.pending = null
        render()
      }
    }
  }
  async function loadGroups() {
    if (groupsPending) return groupsPending
    const current = currentRequest(),
      revision = stickerCollectionRevision(controller)
    const operation = (async () => {
      const choices = parseStickerGroups(
        await controller.connection.call('stickerGroups', { scope }),
      )
      if (!current()) return
      const nextGroup = choices.some((group) => group.id === groupId)
        ? groupId
        : choices[0]?.id || ''
      if (nextGroup !== groupId) {
        const previous = activeGroup()
        if (previous && box.open && content.matches(':popover-open'))
          previous.scroll = captureScroll()
        groupId = nextGroup
        editing = false
        selected.clear()
      }
      select.replaceChildren(
        ...choices.map((group) => {
          cache(group.id)
          const option = el('option', '', group.name)
          option.value = group.id
          return option
        }),
      )
      select.value = groupId
      select.hidden = choices.length < 2
      groupsLoaded = true
      groupsSyncedRevision = revision
    })()
    groupsPending = operation
    render()
    try {
      await operation
    } finally {
      if (current()) {
        groupsPending = null
        render()
      }
    }
  }
  async function refreshVisible() {
    if (refreshPending) return refreshPending
    const current = currentRequest()
    const operation = (async () => {
      while (current() && box.open) {
        if (!groupsLoaded || groupsDirtyRevision > groupsSyncedRevision) await loadGroups()
        if (!current() || !box.open) return
        const group = activeGroup()
        if (!group) return
        if (group.pending) await group.pending
        if (!current() || !box.open) return
        if (!group.loaded || group.dirtyRevision > group.syncedRevision)
          await loadPage(group, group.loaded)
        if (!current() || !box.open) return
        if (
          group === activeGroup() &&
          groupsDirtyRevision <= groupsSyncedRevision &&
          group.dirtyRevision <= group.syncedRevision
        )
          return
      }
    })()
    refreshPending = operation
    try {
      await operation
    } finally {
      if (refreshPending === operation) refreshPending = null
    }
  }
  select.addEventListener('change', () => {
    if (groupsPending || activeGroup()?.pending || mutating || editing) {
      select.value = groupId
      return
    }
    const previous = activeGroup()
    if (previous) previous.scroll = captureScroll()
    groupId = select.value
    selected.clear()
    render(true)
    void read(refreshVisible)
  })
  const loadMore = () => {
    const group = activeGroup()
    if (
      !box.open ||
      disposed ||
      !group?.loaded ||
      groupsPending ||
      group.pending ||
      mutating ||
      editing ||
      !group.hasMore
    )
      return
    if (list.scrollHeight - list.scrollTop - list.clientHeight < 48)
      void read(() => loadPage(group))
  }
  list.addEventListener('scroll', () => {
    const top = list.scrollTop,
      down = top > lastTop,
      group = activeGroup()
    lastTop = top
    if (group && box.open && content.matches(':popover-open')) group.scroll = captureScroll()
    if (down) loadMore()
  })
  list.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY > 0) loadMore()
    },
    { passive: true },
  )
  const saveBeforeClose = (event: ToggleEvent) => {
    if (event.newState !== 'closed' || disposed || accountUid !== controller.state.account?.uid)
      return
    const group = activeGroup()
    // A scroll event can still be queued when Escape or a click closes the picker.
    // Read the final position before hiding makes the anchor rectangles unavailable.
    if (group && content.matches(':popover-open')) group.scroll = captureScroll()
  }
  content.addEventListener('beforetoggle', saveBeforeClose)
  box.addEventListener('toggle', () => {
    if (!box.open || !controller.state.account) return
    render(true)
    void read(refreshVisible)
  })
  const stopCollection = subscribeStickerCollection(controller, (change) => {
    if (disposed || change.uid !== accountUid || change.uid !== controller.state.account?.uid)
      return
    if (change.removedIds) {
      const ids = new Set(change.removedIds)
      for (const id of ids) {
        removedAt.set(id, change.revision)
        selected.delete(id)
      }
      for (const group of groups.values())
        for (const [key, item] of group.items) {
          if (!ids.has(item.emojiId)) continue
          group.items.delete(key)
          group.nodes.delete(key)
        }
      render()
    } else {
      groupsDirtyRevision = change.revision
      for (const group of groups.values()) group.dirtyRevision = change.revision
      if (box.open) void read(refreshVisible)
    }
  })
  const stopAccount = controller.subscribe(() => {
    if (accountUid === controller.state.account?.uid) return
    accountUid = controller.state.account?.uid
    epoch++
    groupsLoaded = mutating = editing = false
    groupsDirtyRevision = 0
    groupsSyncedRevision = -1
    groupsPending = refreshPending = null
    groupId = ''
    groups.clear()
    removedAt.clear()
    selected.clear()
    select.replaceChildren()
    render()
    box.open = false
  })
  render()
  return {
    node: box,
    dispose() {
      disposed = true
      epoch++
      stopCollection()
      stopAccount()
      content.removeEventListener('beforetoggle', saveBeforeClose)
      popup.dispose()
    },
  }
}
