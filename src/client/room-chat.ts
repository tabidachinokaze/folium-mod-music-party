import type { ChatMessage } from '@party/shared/types'
import type { PartyController } from './controller'
import { el, messageNode } from './dom'
import { createStickerPicker } from './sticker-view'
import { mountMentionComposer } from './mention-composer'
import { decorateRoomMessage } from './room-message'
import { createComposerTools, uploadImage } from './private-tools'
import { mountStickerMenu } from './sticker-menu'
import { mountComposerSubmit } from './composer-submit'
import { mountLiveChatComposer } from './live-chat-composer'

import { getLocale, t } from './i18n'

// src/client/room-chat.ts
export function mountRoomChat(
  container: HTMLElement,
  controller: PartyController,
  onEditorIdle: () => void = () => {},
) {
  const history = el('div', 'mp-history')
  history.setAttribute('aria-label', t('房间聊天记录'))
  history.tabIndex = 0
  const composer = el('form', 'mp-composer'),
    draft = el('textarea')
  draft.maxLength = 100
  draft.placeholder = t('聊聊这首歌，输入 @ 提及成员…')
  draft.setAttribute('aria-label', t('房间聊天内容'))
  const mentions = mountMentionComposer({
    draft,
    composer,
    members: () => controller.state.room?.members || [],
    notify: (message) => controller.notify(message),
  })
  const sticker = createStickerPicker(
    controller,
    async (emoji) => {
      await controller.send(`[${emoji.emojiName}]`, emoji)
      liveComposer.complete()
    },
    'room',
  )
  const send = el('button', 'mp-button primary', t('发送'))
  send.type = 'submit'
  const stopSubmit = mountComposerSubmit(draft, composer, send)
  const tools = createComposerTools(
    controller,
    draft,
    (task) => controller.run(task),
    async (file, isCurrent) => {
      const room = controller.requireRoom(),
        account = controller.state.account?.uid
      await uploadImage(controller, file, { kind: 'room', roomId: room.roomId }, isCurrent)
      if (
        controller.state.account?.uid === account &&
        controller.state.room?.roomId === room.roomId
      ) {
        await controller.refreshChat()
        followLatest = true
        toLatest()
        liveComposer.complete()
      }
    },
    () => controller.state.room?.roomId || null,
  )
  const actions = el('div', 'mp-composer-tools mp-room-composer-tools')
  // Compact tools reserve one line for the native sidebar in either language.
  // Summary labels remain available to assistive technology and as tooltips.
  const compactTool = (box: HTMLDetailsElement, fallback: string, icon?: string) => {
    const summary = box.querySelector('summary')!
    const label = summary.textContent || ''
    summary.setAttribute('aria-label', label)
    summary.title = label
    const visual = el('span', 'mp-composer-tool-icon', fallback)
    visual.setAttribute('aria-hidden', 'true')
    summary.replaceChildren(visual)
    if (icon)
      void controller.folium.ui
        .icon(icon, { size: 16 })
        .then((svg) => {
          if (!disposed && svg) visual.replaceChildren(svg)
        })
        .catch(() => {})
  }
  compactTool(tools.nodes[0], '☺', 'smile')
  compactTool(tools.nodes[1], '(ω)')
  compactTool(sticker.node, '▧', 'sticker')
  compactTool(tools.image, '▧', 'image')
  actions.append(...tools.nodes, sticker.node, tools.image, send)
  composer.append(draft, actions)
  container.append(history, composer)
  const liveComposer = mountLiveChatComposer({
    container,
    composer,
    draft,
    emoji: tools.nodes[0],
    icon: controller.folium.ui.icon('smile', { size: 18 }),
    onEditorIdle,
    closeTools() {
      mentions.close()
      tools.close()
      sticker.node.open = false
    },
  })
  const stickerMenu = mountStickerMenu(history, controller)
  let visible = false,
    disposed = false,
    followLatest = true,
    loadingOlder = false
  let frame = 0,
    lastTop = 0,
    lastClientHeight = history.clientHeight,
    lastScrollHeight = history.scrollHeight,
    roomId = ''
  let previous: ChatMessage[] = []
  const rows = new Map<string, { signature: string; node: HTMLElement }>()
  const toLatest = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (!visible || disposed || !followLatest) return
      history.scrollTop = history.scrollHeight
      lastTop = history.scrollTop
      lastClientHeight = history.clientHeight
      lastScrollHeight = history.scrollHeight
    })
  }
  const resize = new ResizeObserver(toLatest)
  resize.observe(history)
  // Upward user movement requests history. Programmatic positioning must never paginate.
  const older = async () => {
    if (!visible || loadingOlder || !controller.state.chatMore || !controller.state.chatCursor)
      return
    loadingOlder = true
    history.setAttribute('aria-busy', 'true')
    try {
      await controller.refreshChat(true)
    } finally {
      loadingOlder = false
      history.removeAttribute('aria-busy')
    }
  }
  history.addEventListener('scroll', () => {
    const top = history.scrollTop,
      geometryChanged =
        lastClientHeight !== history.clientHeight || lastScrollHeight !== history.scrollHeight
    lastClientHeight = history.clientHeight
    lastScrollHeight = history.scrollHeight
    const up = top < lastTop
    lastTop = top
    if (!visible) return
    // A resize can move the bottom before its scheduled correction. Preserve
    // follow mode; upward wheel input explicitly disables it before scrolling.
    if (geometryChanged && followLatest) {
      toLatest()
      return
    }
    followLatest = history.scrollHeight - top - history.clientHeight < 32
    if (up && top < 40) void older()
  })
  history.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY < 0) {
        followLatest = false
        if (history.scrollTop < 40) void older()
      }
    },
    { passive: true },
  )
  history.addEventListener(
    'load',
    () => {
      if (followLatest) toLatest()
    },
    true,
  )
  composer.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = draft.value
    if (!text.trim()) return
    mentions.close()
    void controller.run(async () => {
      await controller.send(text)
      if (draft.value === text) {
        draft.value = ''
        liveComposer.complete()
      }
      followLatest = true
      toLatest()
    })
  })
  const render = () => {
    const state = controller.state
    send.disabled = state.busy || !state.room
    draft.disabled = !state.room
    tools.image.inert = state.busy || !state.room
    tools.sync()
    liveComposer.sync()
    if (state.room?.roomId !== roomId) {
      roomId = state.room?.roomId || ''
      previous = []
      rows.clear()
      followLatest = true
      draft.value = ''
      liveComposer.collapse()
      liveComposer.sync()
      mentions.close()
      tools.close()
      stickerMenu.close()
    }
    if (previous === state.messages) return
    const top = history.scrollTop,
      height = history.scrollHeight
    const prepended =
      previous.length > 0 && state.messages.findIndex((m) => m.id === previous[0].id) > 0
    const visibleIds = new Set(state.messages.map((message) => message.id))
    for (const id of rows.keys()) if (!visibleIds.has(id)) rows.delete(id)
    const displayContext = [getLocale(), new Date().toDateString()]
    const nodes = state.messages.map((message) => {
      const avatar =
        message.avatar ||
        state.room?.members.find((member) => member.uid === message.uid)?.avatar ||
        ''
      const signature = JSON.stringify([
        message,
        avatar,
        state.account?.uid,
        state.account?.nickname,
        displayContext,
      ])
      const existing = rows.get(message.id)
      if (existing?.signature === signature) return existing.node
      const row = messageNode(message, message.uid === state.account?.uid, controller.folium.ui)
      decorateRoomMessage(row, { ...message, avatar }, state.account?.nickname || '', (member) => {
        liveComposer.expand()
        mentions.mention(member)
      })
      rows.set(message.id, { signature, node: row })
      return row
    })
    // Polling and newly arriving messages must not detach existing images:
    // collection menus retain their anchor, and decoded media stays in place.
    const retained = new Set<HTMLElement>(nodes)
    for (const child of Array.from(history.children))
      if (!retained.has(child as HTMLElement)) child.remove()
    let next = history.firstChild
    for (const node of nodes) {
      if (node === next) next = next.nextSibling
      else history.insertBefore(node, next)
    }
    if (!state.messages.length) history.append(el('p', 'mp-empty', t('还没有聊天消息')))
    previous = state.messages
    if (!visible) return
    if (followLatest && !loadingOlder) toLatest()
    else {
      history.scrollTop = top + (prepended ? history.scrollHeight - height : 0)
      lastTop = history.scrollTop
    }
  }
  const stop = controller.subscribe(render)
  render()
  return {
    canRebuild: () => !controller.state.busy && !liveComposer.isComposing(),
    setLiveMode: liveComposer.setEnabled,
    getLiveComposerState: liveComposer.getState,
    restoreLiveComposerState: liveComposer.restoreState,
    getScrollState() {
      return { top: history.scrollTop, followLatest }
    },
    restoreScrollState(state: { top: number; followLatest: boolean }) {
      cancelAnimationFrame(frame)
      followLatest = state.followLatest
      history.scrollTop = state.top
      lastTop = history.scrollTop
      lastClientHeight = history.clientHeight
      lastScrollHeight = history.scrollHeight
      if (visible && followLatest) toLatest()
    },
    show(value: boolean, preservePosition = false) {
      if (visible === value) return
      visible = value
      if (visible) {
        if (!preservePosition) followLatest = true
        if (followLatest) toLatest()
      } else {
        liveComposer.collapse()
        mentions.close()
        tools.close()
        sticker.node.open = false
        stickerMenu.close()
      }
    },
    dispose() {
      disposed = true
      rows.clear()
      stop()
      cancelAnimationFrame(frame)
      resize.disconnect()
      stopSubmit()
      liveComposer.dispose()
      sticker.dispose()
      mentions.dispose()
      tools.dispose()
      stickerMenu.dispose()
    },
  }
}
