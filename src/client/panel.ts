import { mountLobby } from './lobby-view'
import { mountMembers } from './members-view'
import { mountSurface } from './surface'
import type { FoliumPanelContext } from '../../vendor/folium/contract'
import type { PartyController, PartyState } from './controller'
import { button, el, messageNode } from './dom'
import { createStickerPicker } from './sticker-view'

// src/client/panel.ts
export function mountPanel(
  container: HTMLElement,
  controller: PartyController,
  context?: FoliumPanelContext,
) {
  const { root, page, dispose: disposeSurface } = mountSurface(container, 'mp-panel', context)
  const header = el('header', 'mp-header')
  header.append(el('h2', '', '一起听'))
  const badge = el('span', 'mp-pill', '多人房间')
  header.append(badge)
  const nav = el('nav', 'mp-nav')
  nav.setAttribute('role', 'tablist')
  nav.setAttribute('aria-label', '一起听功能')
  const error = el('div', 'mp-error')
  error.setAttribute('role', 'alert')
  const notice = el('div', 'mp-notice')
  notice.setAttribute('role', 'status')
  const health = el('div', 'mp-health')
  const sections = ['房间', '成员', '聊天'].map((name) => {
    const node = el('section', 'mp-view')
    node.setAttribute('aria-label', name)
    return node
  })
  const [roomView, memberView, chatView] = sections
  roomView.classList.add('mp-room-view')
  memberView.classList.add('mp-members-view')
  chatView.classList.add('mp-chat-view')
  const membersView = mountMembers(memberView, controller)
  let tab = 0
  const tabs = sections.map((section, i) => {
    const pick = button(['房间', '成员', '聊天'][i], () => {
      tab = i
      renderTabs()
    })
    pick.setAttribute('role', 'tab')
    nav.append(pick)
    return pick
  })
  function renderTabs() {
    page.classList.toggle('mp-room-layout', !!controller.state.room && tab === 0)
    membersView.show(tab === 1)
    sections.forEach((section, i) => {
      section.hidden = tab !== i
      tabs[i].setAttribute('aria-selected', String(tab === i))
    })
  }
  const prerequisite = el(
    'div',
    'mp-error',
    '此 Folia 尚未提供 playback.sessions 接口。请升级到 Folia 0.7.12，并使用 Music Party 0.3.4，详见插件安装说明。',
  )
  const lobby = mountLobby(controller)
  const active = el('section', 'mp-lobby-card mp-room-card'),
    roomDetails = el('dl', 'mp-room-details')
  const share = el('footer', 'mp-row mp-room-footer')
  share.append(
    button(
      '复制邀请链接',
      () =>
        void controller.run(async () => {
          await navigator.clipboard.writeText(controller.shareLink())
          controller.patch({ notice: '邀请链接已复制' })
        }),
      'mp-command',
    ),
    button('私信邀请', () => controller.folium.ui.openHomeTab('private')),
    button('退出房间', () => void controller.run(() => controller.leave()), 'danger mp-command'),
  )
  active.append(el('h3', '', '房间信息'), roomDetails)
  roomView.append(prerequisite, active, lobby.node, health, share)

  const history = el('div', 'mp-history'),
    older = button('加载更早的聊天', () => void controller.run(() => controller.refreshChat(true)))
  const composer = el('form', 'mp-composer'),
    draft = el('textarea')
  draft.maxLength = 100
  draft.placeholder = '和房间里的朋友聊聊这首歌…'
  draft.setAttribute('aria-label', '房间聊天内容')
  const sticker = createStickerPicker(
    controller,
    (emoji) => controller.send(`[${emoji.emojiName}]`, emoji),
    'room',
  )
  const send = el('button', 'mp-button primary mp-command', '发送')
  send.type = 'submit'
  composer.append(draft, sticker.node, send)
  composer.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = draft.value
    void controller.run(async () => {
      await controller.send(text)
      if (draft.value === text) draft.value = ''
    })
  })
  chatView.append(
    el('p', 'mp-muted', '与网易云官方多人房间互通 · 最多 100 字'),
    older,
    history,
    composer,
  )
  page.append(header, nav, error, notice, ...sections)
  let previous: PartyState | null = null
  function render() {
    const state = controller.state,
      room = state.room
    badge.textContent = room ? `${room.onlineCount ?? room.members.length} 人一起听` : '多人房间'
    error.textContent = state.error
    error.hidden = !state.error
    notice.textContent = state.notice
    notice.hidden = !state.notice
    health.textContent = state.health
    prerequisite.hidden = state.ready
    page.hidden = !state.account
    nav.hidden = !room
    active.hidden = share.hidden = !room
    tabs[1].disabled = tabs[2].disabled = !room
    if (tab > 0 && !room) tab = 0
    renderTabs()
    if (room) {
      const field = (name: string, value: string) => {
        const node = el('div', 'mp-room-field')
        node.append(el('dt', 'mp-muted', name), el('dd', '', value))
        return node
      }
      const creator = room.members.find((member) => member.uid === room.creatorId)
      roomDetails.replaceChildren(
        field('在线成员', `${room.onlineCount ?? room.members.length} 人`),
        ...(creator?.nickname ? [field('创建者', creator.nickname)] : []),
        ...(room.tags?.length ? [field('音乐标签', room.tags.join(' · '))] : []),
      )
    }
    older.hidden = !state.chatMore
    if (previous?.messages !== state.messages) {
      const nearEnd = history.scrollHeight - history.scrollTop - history.clientHeight < 80
      history.replaceChildren(
        ...state.messages.map((message) =>
          messageNode(message, message.uid === state.account?.uid),
        ),
      )
      if (!state.messages.length) history.append(el('p', 'mp-empty', '还没有聊天消息'))
      if (nearEnd) history.scrollTop = history.scrollHeight
    }
    root.querySelectorAll<HTMLButtonElement>('.mp-command').forEach((command) => {
      command.disabled = state.busy
    })
    lobby.render()
    previous = state
  }
  const stop = controller.subscribe(render),
    stopSong = controller.folium.events.on('playback.songChanged', render)
  render()
  return () => {
    stop()
    stopSong()
    sticker.dispose()
    membersView.dispose()
    disposeSurface()
  }
}
