import {
  mergeConversations,
  parseConversations,
  parsePrivatePage,
} from '@party/shared/private-messages'
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
import { mountComposerSubmit } from './composer-submit'
import { createPrivateRefresh } from './private-refresh'
import { PrivateHistoryGaps } from './private-history-gaps'
import { preservePrivateScroll } from './private-scroll'
import { mergePrivateHistoryView } from './private-history-view'
import { getPrivatePresence } from './private-presence'
import { renderPrivateContacts } from './private-contacts'
import { privateReadBoundary, publishPrivateRead, trackPrivateView } from './private-view-activity'

// src/client/private-view.ts
export interface PrivateViewOptions {
  initialPeer?: Conversation
  conversationOnly?: boolean
  isVisible?(): boolean
  onPeerChange?(peer: Conversation | null): void
  onRead?(uid: string): void
}
export function mountPrivate(
  container: HTMLElement,
  controller: PartyController,
  report: (text: string, error?: boolean) => void,
  options: PrivateViewOptions = {},
) {
  let selected: Conversation | null = null,
    disposed = false,
    generation = 0,
    accountGeneration = 0,
    shown = false
  let offset = 0,
    before: number | null = null,
    messages: PrivateMessage[] = []
  let contactsMore = false,
    historyMore = false,
    listing = false,
    reading = false,
    sending = false,
    refreshing = false,
    acknowledging = false,
    unreadVersion = 0,
    acknowledgedVersion = 0
  const peers = new Map<string, Conversation>()
  const presence = getPrivatePresence(controller)
  const gaps = new PrivateHistoryGaps()
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
  const scroll = preservePrivateScroll(history)
  const title = el('h3', '', t('选择一个私信会话')),
    peerAvatar = el('span', 'mp-avatar mp-presence-avatar mp-peer-avatar'),
    draft = el('textarea')
  peerAvatar.hidden = true
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
    const peer = selected,
      epoch = accountGeneration
    if (!peer) throw new Error(t('请先选择收信人'))
    sending = true
    update()
    try {
      await task(peer)
      if (selected?.uid === peer.uid && !disposed && epoch === accountGeneration)
        await refreshLatest(peer)
    } finally {
      if (epoch === accountGeneration) {
        sending = false
        update()
      }
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
  const stopSubmit = mountComposerSubmit(draft, form, send)
  const actions = el('div', 'mp-composer-tools')
  actions.append(...tools.nodes, sticker.node, tools.image, send)
  form.append(draft, actions)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = draft.value,
      epoch = accountGeneration
    if (!text.trim()) return
    void run(() =>
      sendToPeer(async (peer) => {
        await controller.connection.call('privateSend', {
          uid: peer.uid,
          text,
          requestId: crypto.randomUUID(),
        })
        if (epoch === accountGeneration && selected?.uid === peer.uid && draft.value === text)
          draft.value = ''
      }),
    )
  })
  function renderContacts() {
    renderPrivateContacts(
      contacts,
      [...peers.values()],
      selected?.uid ?? null,
      (uid) => presence.get(uid)?.online,
      (uid) => {
        const peer = peers.get(uid)
        if (peer) void run(() => open(peer))
      },
    )
  }
  function renderOnline(avatar: HTMLElement, uid: string) {
    const online = presence.get(uid)?.online === true
    let dot = avatar.querySelector<HTMLElement>('.mp-presence-dot')
    if (!online) {
      dot?.remove()
      return
    }
    if (!dot) {
      dot = el('span', 'mp-presence-dot')
      dot.setAttribute('role', 'img')
      dot.setAttribute('aria-label', t('在线'))
      dot.title = t('在线')
      avatar.append(dot)
    }
  }
  function renderPeer() {
    peerAvatar.hidden = !selected
    if (!selected) return
    const metadata = presence.get(selected.uid)
    const nickname = metadata?.nickname || selected.nickname,
      avatar = metadata?.avatar || selected.avatar
    title.textContent = nickname
    const signature = `${selected.uid}:${nickname}:${avatar}`
    if (peerAvatar.dataset.profile !== signature) {
      peerAvatar.dataset.profile = signature
      peerAvatar.replaceChildren(el('span', '', Array.from(nickname)[0] || '♪'))
      if (avatar) peerAvatar.append(picture(avatar, ''))
      peerAvatar.setAttribute('aria-label', t('{name}的头像', { name: nickname }))
    }
    renderOnline(peerAvatar, selected.uid)
  }
  function renderPresence() {
    renderPeer()
    if (!options.conversationOnly) renderContacts()
  }
  async function list(more = false, preserve = false) {
    if (options.conversationOnly) return
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
      const previous = [...peers.values()]
      if (!more && !preserve) {
        peers.clear()
        offset = 0
      }
      const merged = mergeConversations([...peers.values()], page.conversations)
      if (preserve) {
        // Newly promoted conversations shift the offset of the older pages already loaded.
        const added = page.conversations.filter((peer) => !peers.has(peer.uid)).length
        offset = Math.max(offset + added, page.count)
        if (!previous.length) contactsMore = page.more && page.count > 0
      } else {
        offset += page.count
        contactsMore = page.more && page.count > 0
      }
      peers.clear()
      merged.forEach((peer) => peers.set(peer.uid, peer))
      if (!previous.length || JSON.stringify(previous) !== JSON.stringify(merged)) renderContacts()
      presenceWatch.refresh()
    } finally {
      if (epoch === accountGeneration) {
        listing = false
        contacts.setAttribute('aria-busy', 'false')
      }
    }
  }
  async function open(peer: Conversation, more = false) {
    if (more && (reading || !historyMore || before === null)) return
    if (!more && selected?.uid === peer.uid && messages.length) return refreshLatest(peer)
    const uid = controller.state.account?.uid
    if (!uid || disposed) return
    const runId = ++generation,
      oldBefore = before
    refreshing = acknowledging = false
    if (selected?.uid !== peer.uid) {
      resourceActions.cancel()
      draft.value = ''
      messages = []
      before = null
      historyMore = false
      gaps.clear()
      unreadVersion = acknowledgedVersion = 0
      acknowledging = false
      history.replaceChildren()
      profiles.clear()
      sticker.node.open = false
      tools.close()
      stickerMenu.close()
    }
    const changedPeer = selected?.uid !== peer.uid
    selected = peer
    renderPeer()
    if (changedPeer) options.onPeerChange?.(peer)
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
        .map((message) => messageNode(message, uid, peer))
      if (more) history.prepend(...nodes)
      else history.replaceChildren(...nodes)
      history.scrollTop = more ? top + history.scrollHeight - height : history.scrollHeight
      lastHistoryTop = history.scrollTop
      scroll.capture()
      if (
        !more &&
        (messages.some((message) => message.senderId !== uid) ||
          (peers.get(peer.uid)?.unread ?? 0) > 0)
      )
        unreadVersion++
      if (!more) await acknowledgeNew()
    } finally {
      if (runId === generation) {
        reading = false
        history.setAttribute('aria-busy', 'false')
        update()
      }
    }
  }
  function messageNode(message: PrivateMessage, uid: string, peer: Conversation) {
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
      (link) => void run(() => controller.enter('join', invitation({ ...link, role: 'guest' }))),
      resourceActions,
    )
  }
  const atLatest = () => history.scrollHeight - history.clientHeight - history.scrollTop < 48
  const active = () =>
    !disposed &&
    shown &&
    options.isVisible?.() !== false &&
    !!controller.state.account &&
    container.isConnected &&
    container.getClientRects().length > 0 &&
    document.visibilityState === 'visible' &&
    document.hasFocus()
  const stopActivity = trackPrivateView(controller, () => selected?.uid ?? null, active)
  async function acknowledgeNew() {
    if (
      !selected ||
      acknowledging ||
      unreadVersion <= acknowledgedVersion ||
      !active() ||
      !atLatest()
    )
      return
    const peer = selected,
      runId = generation,
      version = unreadVersion,
      boundary = privateReadBoundary(messages, controller.state.account!.uid)
    acknowledging = true
    try {
      await controller.connection.call('privateRead', { uid: peer.uid })
      if (disposed || runId !== generation) return
      acknowledgedVersion = version
      publishPrivateRead(controller, peer.uid, boundary)
      options.onRead?.(peer.uid)
      const contact = peers.get(peer.uid)
      if (contact && unreadVersion === version && contact.unread) {
        contact.unread = 0
        renderContacts()
      }
    } finally {
      if (runId === generation) acknowledging = false
    }
  }
  async function refreshLatest(peer: Conversation) {
    const uid = controller.state.account?.uid,
      runId = generation
    if (!uid || disposed || reading || refreshing || selected?.uid !== peer.uid) return
    refreshing = true
    try {
      const applyPage = (response: unknown, gap?: number) => {
        const page = parsePrivatePage(response, uid, peer.uid)
        if (gap === undefined) gaps.observe(messages, page)
        else gaps.accept(gap, page)
        for (const [id, profile] of privateMessageProfiles(response, uid, peer.uid))
          profiles.set(id, profile)
        const merged = mergePrivateHistoryView(
          history,
          messages,
          page.messages,
          (message) => messageNode(message, uid, peer),
          scroll,
        )
        messages = merged.messages
        // The oldest loaded cursor belongs to upward pagination, never to this newest-page request.
        if (before === null) {
          before = page.before
          historyMore = page.more && page.before !== null
        }
        lastHistoryTop = history.scrollTop
        if (merged.added.some((message) => message.senderId !== uid)) unreadVersion++
      }
      const response = await controller.connection.call('privateHistory', { uid: peer.uid })
      if (disposed || runId !== generation) return
      applyPage(response)
      // Bound foreground work to three pages. Further missing ranges resume on the next refresh.
      for (let count = 0; count < 2 && active(); count++) {
        const cursor = gaps.next()
        if (cursor === null) break
        const older = await controller.connection.call('privateHistory', {
          uid: peer.uid,
          before: cursor,
        })
        if (disposed || runId !== generation) return
        applyPage(older, cursor)
      }
      await acknowledgeNew()
    } catch (error) {
      if (!disposed && runId === generation) throw error
    } finally {
      if (runId === generation) refreshing = false
    }
  }
  async function refresh() {
    if (listing || reading || refreshing || sending) return false
    const epoch = accountGeneration,
      runId = generation,
      peer = selected
    try {
      await list(false, true)
      if (disposed || epoch !== accountGeneration || !active()) return
      if (peer && runId === generation) await refreshLatest(peer)
    } catch (error) {
      if (!disposed && epoch === accountGeneration) throw error
    }
  }
  const autoRefresh = createPrivateRefresh({
    active,
    refresh,
    onError: (error) => controller.handleAccountError(error as { code?: number }),
  })
  const stopNotifications = controller.privateNotifications.subscribe(() => {
    // Events never acknowledge messages. Hidden/unfocused views just become
    // dirty; the existing refresh/read guards decide when HTTP work is allowed.
    autoRefresh.invalidate()
  })
  let lastHistoryTop = 0,
    wasAtLatest = true
  contacts.addEventListener('scroll', () => {
    presenceWatch.refresh()
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
    scroll.capture()
    const latest = atLatest()
    if (latest && !wasAtLatest) {
      const epoch = accountGeneration
      void acknowledgeNew().catch((error) => {
        if (!disposed && epoch === accountGeneration)
          controller.handleAccountError(error as { code?: number })
      })
    }
    wasAtLatest = latest
  })
  const refreshButton = iconButton(
    controller.folium.ui,
    t('刷新私信'),
    'refresh',
    () => void run(refresh),
  )
  const sidebar = el('aside', 'mp-private-sidebar'),
    conversation = el('div', 'mp-private-conversation'),
    heading = el('header', 'mp-conversation-header')
  sidebar.append(contacts)
  heading.append(peerAvatar, title, invite)
  conversation.append(heading, history, form)
  if (options.conversationOnly) {
    container.classList.add('mp-private-conversation-only')
    container.append(conversation)
  } else container.append(sidebar, conversation)
  const stickerMenu = mountStickerMenu(history, controller)
  const presenceWatch = presence.watch({
    active,
    peers: () => {
      const visible = selected ? [selected.uid] : []
      if (options.conversationOnly) return visible
      const bounds = contacts.getBoundingClientRect()
      for (const contact of contacts.querySelectorAll<HTMLElement>('.mp-contact')) {
        const rect = contact.getBoundingClientRect()
        if (
          contact.dataset.uid &&
          rect.height > 0 &&
          rect.bottom > Math.max(0, bounds.top) &&
          rect.top < Math.min(innerHeight, bounds.bottom)
        )
          visible.push(contact.dataset.uid)
      }
      // Query loaded offscreen peers too, so an online contact can move into view.
      // The account-scoped service bounds concurrency, cache and request budget.
      return [...new Set([...visible, ...peers.keys()])]
    },
    changed: renderPresence,
  })
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
    autoRefresh.resume()
    presenceWatch.refresh()
  }
  return {
    refreshButton,
    update,
    open(peer: Conversation) {
      return run(() => open(peer))
    },
    focus() {
      if (!disposed && shown && options.isVisible?.() !== false && !draft.disabled)
        draft.focus({ preventScroll: true })
    },
    show() {
      if (disposed) return
      if (shown) {
        autoRefresh.resume()
        presenceWatch.refresh()
        return
      }
      shown = true
      if (!selected && options.initialPeer) void run(() => open(options.initialPeer!))
      else if (!options.conversationOnly) void run(() => list(false, true))
      if (selected) autoRefresh.invalidate()
      autoRefresh.start()
      presenceWatch.refresh()
    },
    hide() {
      shown = false
      autoRefresh.stop()
      resourceActions.cancel()
      songChoice.close()
      sticker.node.open = false
      tools.close()
      stickerMenu.close()
      presenceWatch.refresh()
    },
    reset() {
      shown = false
      autoRefresh.stop()
      resourceActions.cancel()
      generation++
      accountGeneration++
      selected = null
      options.onPeerChange?.(null)
      peerAvatar.hidden = true
      messages = []
      gaps.clear()
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
      contactsMore = historyMore = listing = reading = sending = refreshing = acknowledging = false
      unreadVersion = acknowledgedVersion = 0
      update()
    },
    dispose() {
      disposed = true
      stopNotifications()
      stopActivity()
      presenceWatch.dispose()
      autoRefresh.dispose()
      scroll.dispose()
      stopSubmit()
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
