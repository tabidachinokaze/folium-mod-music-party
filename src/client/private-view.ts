import { parseConversations, parsePrivatePage } from '@party/shared/private-messages'
import { invitation } from '@party/shared/protocol'
import type { Conversation, PrivateMessage } from '@party/shared/types'
import type { PartyController } from './controller'
import { button, el, iconButton, picture } from './dom'
import { createStickerPicker } from './sticker-view'
import { createPrivateTools } from './private-tools'
import { privateMessageNode, privateMessageProfiles, type PrivateProfile } from './private-message'
import { t } from './i18n'
import { createPrivateResourceActions } from './private-actions'
import { createPrivateSongChoice } from './private-song-choice'
import { mountStickerMenu } from './sticker-menu'

// src/client/private-view.ts
export function mountPrivate(
  container: HTMLElement,
  controller: PartyController,
  report: (text: string, error?: boolean) => void,
) {
  let selected: Conversation | null = null,
    disposed = false,
    generation = 0,
    accountGeneration = 0
  let offset = 0,
    before: number | null = null,
    messages: PrivateMessage[] = []
  let contactsMore = false,
    historyMore = false,
    listing = false,
    reading = false,
    sending = false
  const peers = new Map<string, Conversation>()
  const songChoice = createPrivateSongChoice(container)
  const resourceActions = createPrivateResourceActions(
    controller,
    () => (!disposed && selected ? selected.uid : null),
    report,
    undefined,
    songChoice.choose,
  )
  let actionAccount = controller.state.account?.uid,
    actionRoom = controller.state.room?.roomId
  const profiles = new Map<string, PrivateProfile>()
  const contacts = el('div', 'mp-contacts'),
    history = el('div', 'mp-history')
  contacts.setAttribute('aria-label', t('会话列表'))
  history.setAttribute('aria-label', t('聊天消息'))
  const title = el('h3', '', t('选择一个私信会话')),
    draft = el('textarea')
  draft.placeholder = t('发送私信…')
  draft.maxLength = 500
  draft.setAttribute('aria-label', t('私信内容'))
  const form = el('form', 'mp-composer')
  const run = async (task: () => Promise<unknown>) => {
    const epoch = accountGeneration
    report('')
    try {
      await task()
    } catch (error) {
      if (!disposed && epoch === accountGeneration) {
        controller.handleAccountError(error as { code?: number })
        report(t(error instanceof Error ? error.message : '私信操作失败'), true)
      }
    }
  }
  const sendToPeer = async (task: (peer: Conversation) => Promise<unknown>) => {
    if (sending) return
    const peer = selected
    if (!peer) throw new Error(t('请先选择收信人'))
    sending = true
    update()
    try {
      await task(peer)
      if (selected?.uid === peer.uid && !disposed) await open(peer)
    } finally {
      sending = false
      update()
    }
  }
  const invite = button(
    t('邀请一起听'),
    () =>
      void run(() =>
        sendToPeer(async (peer) => {
          await controller.connection.call('privateInvite', {
            uid: peer.uid,
            roomId: controller.requireRoom().roomId,
            requestId: crypto.randomUUID(),
          })
          report(t('已发送一起听邀请'))
        }),
      ),
  )
  const sticker = createStickerPicker(
    controller,
    (emoji) =>
      sendToPeer((peer) =>
        controller.connection.call('privateSticker', {
          uid: peer.uid,
          emoji,
          requestId: crypto.randomUUID(),
        }),
      ),
    'private',
    run,
  )
  const tools = createPrivateTools(
    controller,
    draft,
    run,
    (target) => sendToPeer((peer) => target(peer.uid)),
    () => selected?.uid || null,
  )
  const send = el('button', 'mp-button primary', t('发送'))
  send.type = 'submit'
  const actions = el('div', 'mp-composer-tools')
  actions.append(...tools.nodes, sticker.node, tools.image, send)
  form.append(draft, actions)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = draft.value
    if (!text.trim()) return
    void run(() =>
      sendToPeer(async (peer) => {
        await controller.connection.call('privateSend', {
          uid: peer.uid,
          text,
          requestId: crypto.randomUUID(),
        })
        if (selected?.uid === peer.uid && draft.value === text) draft.value = ''
      }),
    )
  })
  function renderContacts() {
    const top = contacts.scrollTop
    contacts.replaceChildren(
      ...[...peers.values()].map((peer) => {
        const pick = button('', () => void run(() => open(peer)), 'mp-contact')
        pick.dataset.uid = peer.uid
        pick.setAttribute(
          'aria-label',
          peer.unread
            ? t('{name} · {count} 未读', { name: peer.nickname, count: peer.unread })
            : peer.nickname,
        )
        pick.setAttribute('aria-pressed', String(selected?.uid === peer.uid))
        const avatar = el('span', 'mp-avatar', peer.nickname.slice(0, 1))
        if (peer.avatar) avatar.append(picture(peer.avatar, ''))
        const info = el('span', 'mp-contact-info')
        info.append(
          el('strong', '', peer.nickname),
          el('span', 'mp-contact-preview', peer.preview || t('暂无消息')),
        )
        pick.append(avatar, info)
        if (peer.unread)
          pick.append(el('span', 'mp-unread', peer.unread > 99 ? '99+' : String(peer.unread)))
        return pick
      }),
    )
    if (!peers.size) contacts.append(el('p', 'mp-empty', t('暂无私信会话')))
    contacts.scrollTop = top
  }
  async function list(more = false) {
    if (listing || (more && !contactsMore)) return
    const uid = controller.state.account?.uid,
      epoch = accountGeneration
    if (!uid) return
    listing = true
    contacts.setAttribute('aria-busy', 'true')
    try {
      const page = parseConversations(
        await controller.connection.call('privateConversations', { offset: more ? offset : 0 }),
        uid,
      )
      if (disposed || epoch !== accountGeneration) return
      if (!more) {
        peers.clear()
        offset = 0
      }
      page.conversations.forEach((peer) => peers.set(peer.uid, peer))
      offset += page.count
      contactsMore = page.more && page.count > 0
      renderContacts()
    } finally {
      if (epoch === accountGeneration) {
        listing = false
        contacts.setAttribute('aria-busy', 'false')
      }
    }
  }
  async function open(peer: Conversation, more = false) {
    if (more && (reading || !historyMore || before === null)) return
    const uid = controller.state.account?.uid
    if (!uid || disposed) return
    const runId = ++generation,
      oldBefore = before
    if (selected?.uid !== peer.uid) {
      resourceActions.cancel()
      draft.value = ''
      messages = []
      before = null
      historyMore = false
      history.replaceChildren()
      profiles.clear()
      sticker.node.open = false
      tools.close()
      stickerMenu.close()
    }
    selected = peer
    title.textContent = peer.nickname
    reading = true
    update()
    renderContacts()
    history.setAttribute('aria-busy', 'true')
    try {
      const response = await controller.connection.call('privateHistory', {
        uid: peer.uid,
        ...(more && before !== null ? { before } : {}),
      })
      if (disposed || runId !== generation) return
      const page = parsePrivatePage(response, uid, peer.uid)
      for (const [id, profile] of privateMessageProfiles(response, uid, peer.uid))
        profiles.set(id, profile)
      const merged = new Map((more ? messages : []).map((message) => [message.id, message]))
      page.messages.forEach((message) => merged.set(message.id, message))
      messages = [...merged.values()].sort((a, b) => a.time - b.time)
      before = page.before
      historyMore =
        page.more &&
        page.before !== null &&
        (!more || oldBefore === null || page.before < oldBefore)
      const top = history.scrollTop,
        height = history.scrollHeight
      // Preserve already loaded media nodes when prepending, so their sizes and playback stay stable.
      const existing = new Set(
        [...history.children].map((node) => (node as HTMLElement).dataset.messageId),
      )
      const nodes = messages
        .filter((message) => !more || !existing.has(message.id))
        .map((message) => {
          const mine = message.senderId === uid,
            profile = profiles.get(message.senderId)
          return privateMessageNode(
            message,
            mine,
            {
              uid: message.senderId,
              nickname:
                profile?.nickname ||
                (mine ? controller.state.account?.nickname || t('我') : peer.nickname),
              avatar: profile?.avatar || (mine ? '' : peer.avatar),
            },
            (link) =>
              void run(() => controller.enter('join', invitation({ ...link, role: 'guest' }))),
            resourceActions,
          )
        })
      if (more) history.prepend(...nodes)
      else history.replaceChildren(...nodes)
      history.scrollTop = more ? top + history.scrollHeight - height : history.scrollHeight
      lastHistoryTop = history.scrollTop
      if (!more && document.visibilityState === 'visible' && document.hasFocus()) {
        await controller.connection.call('privateRead', { uid: peer.uid })
        if (disposed || runId !== generation) return
        const contact = peers.get(peer.uid)
        if (contact) {
          contact.unread = 0
          renderContacts()
        }
      }
    } finally {
      if (runId === generation) {
        reading = false
        history.setAttribute('aria-busy', 'false')
        update()
      }
    }
  }
  let lastHistoryTop = 0
  contacts.addEventListener('scroll', () => {
    if (
      contacts.scrollTop > 0 &&
      contacts.scrollHeight - contacts.scrollTop - contacts.clientHeight < 100
    )
      void run(() => list(true))
  })
  contacts.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY > 0 && contacts.scrollHeight <= contacts.clientHeight)
        void run(() => list(true))
    },
    { passive: true },
  )
  history.addEventListener(
    'wheel',
    (event) => {
      if (event.deltaY < 0 && history.scrollTop === 0 && selected)
        void run(() => open(selected!, true))
    },
    { passive: true },
  )
  history.addEventListener('scroll', () => {
    const top = history.scrollTop
    if (top < lastHistoryTop && top < 60 && selected) void run(() => open(selected!, true))
    lastHistoryTop = top
  })
  const refreshButton = iconButton(
    controller.folium.ui,
    t('刷新私信'),
    'refresh',
    () =>
      void run(async () => {
        await list()
        if (selected) await open(selected)
      }),
  )
  const sidebar = el('aside', 'mp-private-sidebar'),
    conversation = el('div', 'mp-private-conversation'),
    heading = el('header', 'mp-conversation-header')
  sidebar.append(contacts)
  heading.append(title, invite)
  conversation.append(heading, history, form)
  container.append(sidebar, conversation)
  const stickerMenu = mountStickerMenu(history, controller)
  function update() {
    const account = controller.state.account?.uid,
      room = controller.state.room?.roomId
    if (actionAccount !== account || actionRoom !== room) resourceActions.cancel()
    actionAccount = account
    actionRoom = room
    invite.disabled = !selected || !controller.state.room || sending
    send.disabled = !selected || sending
    draft.disabled = !selected || sending
    actions.inert = !selected || sending
    tools.sync()
  }
  return {
    refreshButton,
    update,
    show() {
      void run(() => list())
    },
    reset() {
      resourceActions.cancel()
      generation++
      accountGeneration++
      selected = null
      messages = []
      peers.clear()
      profiles.clear()
      contacts.replaceChildren()
      history.replaceChildren()
      draft.value = ''
      sticker.node.open = false
      tools.close()
      stickerMenu.close()
      title.textContent = t('选择一个私信会话')
      before = null
      offset = 0
      contactsMore = historyMore = listing = reading = false
      update()
    },
    dispose() {
      disposed = true
      resourceActions.cancel()
      songChoice.dispose()
      generation++
      accountGeneration++
      sticker.dispose()
      tools.dispose()
      stickerMenu.dispose()
    },
  }
}
