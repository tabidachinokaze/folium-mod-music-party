import { parseConversations, parsePrivatePage } from '@party/shared/private-messages'
import { invitation } from '@party/shared/protocol'
import type { Conversation, PrivateMessage } from '@party/shared/types'
import type { PartyController } from './controller'
import { button, el, messageNode } from './dom'
import { createStickerPicker } from './sticker-view'

// src/client/private-view.ts
export function mountPrivate(container: HTMLElement, controller: PartyController) {
  let selected: Conversation | null = null,
    disposed = false,
    generation = 0,
    offset = 0
  let before: number | null = null,
    messages: PrivateMessage[] = []
  const contacts = el('div', 'mp-contacts'),
    history = el('div', 'mp-history')
  const title = el('h3', '', '选择一个私信会话')
  const draft = el('textarea')
  draft.placeholder = '发送私信…'
  draft.maxLength = 500
  draft.setAttribute('aria-label', '私信内容')
  const form = el('form', 'mp-composer')
  const older = button('更早的消息', () => void controller.run(() => open(selected!, true)))
  older.hidden = true
  const loadMore = button('更多会话', () => void controller.run(() => list(true)))
  loadMore.hidden = true
  const invite = button(
    '邀请一起听',
    () =>
      void controller.run(async () => {
        if (!selected) throw new Error('请先选择收信人')
        await controller.connection.call('privateInvite', {
          uid: selected.uid,
          roomId: controller.requireRoom().roomId,
          requestId: crypto.randomUUID(),
        })
        controller.patch({ notice: '已向所选好友发送一起听邀请' })
        await open(selected)
      }),
    'mp-command',
  )
  const sticker = createStickerPicker(
    controller,
    async (emoji) => {
      if (!selected) throw new Error('请先选择收信人')
      await controller.connection.call('privateSticker', {
        uid: selected.uid,
        emoji,
        requestId: crypto.randomUUID(),
      })
      await open(selected)
    },
    'private',
  )
  const send = el('button', 'mp-button primary mp-command', '发送')
  send.type = 'submit'
  form.append(draft, sticker.node, send)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = draft.value,
      peer = selected
    void controller.run(async () => {
      if (!peer) throw new Error('请先选择收信人')
      await controller.connection.call('privateSend', {
        uid: peer.uid,
        text,
        requestId: crypto.randomUUID(),
      })
      if (selected?.uid === peer.uid) {
        if (draft.value === text) draft.value = ''
        await open(peer)
      }
    })
  })
  async function list(more = false) {
    const uid = controller.state.account?.uid
    if (!uid) throw new Error('请先连接网易云账号')
    const page = parseConversations(
      await controller.connection.call('privateConversations', { offset: more ? offset : 0 }),
      uid,
    )
    if (disposed) return
    if (!more) {
      contacts.replaceChildren()
      offset = 0
    }
    offset += page.count
    page.conversations.forEach((peer) => {
      const pick = button(
        `${peer.nickname}${peer.unread ? ` · ${peer.unread} 未读` : ''}`,
        () => void controller.run(() => open(peer)),
        'mp-contact',
      )
      contacts.append(pick)
    })
    if (!contacts.childElementCount) contacts.append(el('p', 'mp-muted', '暂无私信会话'))
    loadMore.hidden = !page.more
  }
  async function open(peer: Conversation, more = false) {
    const run = ++generation,
      uid = controller.state.account?.uid
    if (!uid || !peer) return
    if (selected?.uid !== peer.uid) {
      draft.value = ''
      messages = []
      before = null
      history.replaceChildren()
    }
    selected = peer
    title.textContent = peer.nickname
    const page = parsePrivatePage(
      await controller.connection.call('privateHistory', {
        uid: peer.uid,
        ...(more && before !== null ? { before } : {}),
      }),
      uid,
      peer.uid,
    )
    if (disposed || run !== generation) return
    const merged = new Map((more ? messages : []).map((message) => [message.id, message]))
    page.messages.forEach((message) => merged.set(message.id, message))
    messages = [...merged.values()].sort((a, b) => a.time - b.time)
    before = page.before
    older.hidden = !page.more
    history.replaceChildren(
      ...messages.map((message) => {
        const node = messageNode(message, message.senderId === uid)
        for (const link of message.invitations)
          node.append(
            button(
              '加入多人房间',
              () =>
                void controller.run(() =>
                  controller.enter('join', invitation({ ...link, role: 'guest' })),
                ),
              'mp-command',
            ),
          )
        return node
      }),
    )
    if (!more) history.scrollTop = history.scrollHeight
    if (!container.hidden && document.visibilityState === 'visible' && document.hasFocus()) {
      await controller.connection.call('privateRead', { uid: peer.uid })
      if (!disposed && run === generation) await list()
    }
  }
  const toolbar = el('div', 'mp-row')
  toolbar.append(
    button('刷新私信', () => void controller.run(() => (selected ? open(selected) : list()))),
    invite,
  )
  container.append(toolbar, contacts, loadMore, title, older, history, form)
  return {
    show() {
      if (!contacts.childElementCount) void controller.run(() => list())
    },
    reset() {
      generation++
      selected = null
      messages = []
      contacts.replaceChildren()
      history.replaceChildren()
      draft.value = ''
      sticker.node.open = false
    },
    dispose() {
      disposed = true
      generation++
      sticker.dispose()
    },
  }
}
