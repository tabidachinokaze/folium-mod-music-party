import type { ChatMessage } from '@party/shared/types'
import type { PartyController } from './controller'
import { el, messageNode } from './dom'
import { createStickerPicker } from './sticker-view'

// src/client/room-chat.ts
export function mountRoomChat(container: HTMLElement, controller: PartyController) {
  const history = el('div', 'mp-history')
  history.setAttribute('aria-label', '房间聊天记录')
  history.tabIndex = 0
  const composer = el('form', 'mp-composer'),
    draft = el('textarea')
  draft.maxLength = 100
  draft.placeholder = '聊聊这首歌…'
  draft.setAttribute('aria-label', '房间聊天内容')
  const sticker = createStickerPicker(
    controller,
    (emoji) => controller.send(`[${emoji.emojiName}]`, emoji),
    'room',
  )
  const send = el('button', 'mp-button primary', '发送')
  send.type = 'submit'
  composer.append(draft, sticker.node, send)
  container.append(history, composer)
  let visible = false,
    disposed = false,
    followLatest = true,
    loadingOlder = false
  let frame = 0,
    lastTop = 0,
    roomId = ''
  let previous: ChatMessage[] = []
  const toLatest = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (!visible || disposed || !followLatest) return
      history.scrollTop = history.scrollHeight
      lastTop = history.scrollTop
    })
  }
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
    const top = history.scrollTop
    const up = top < lastTop
    lastTop = top
    if (!visible) return
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
    void controller.run(async () => {
      await controller.send(text)
      if (draft.value === text) draft.value = ''
      followLatest = true
      toLatest()
    })
  })
  const render = () => {
    const state = controller.state
    send.disabled = state.busy || !state.room
    if (state.room?.roomId !== roomId) {
      roomId = state.room?.roomId || ''
      previous = []
      followLatest = true
    }
    if (previous === state.messages) return
    const top = history.scrollTop,
      height = history.scrollHeight
    const prepended =
      previous.length > 0 && state.messages.findIndex((m) => m.id === previous[0].id) > 0
    history.replaceChildren(
      ...state.messages.map((message) => messageNode(message, message.uid === state.account?.uid)),
    )
    if (!state.messages.length) history.append(el('p', 'mp-empty', '还没有聊天消息'))
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
    show(value: boolean) {
      if (visible === value) return
      visible = value
      if (visible) {
        followLatest = true
        toLatest()
      }
    },
    dispose() {
      disposed = true
      stop()
      cancelAnimationFrame(frame)
      sticker.dispose()
    },
  }
}
