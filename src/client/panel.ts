import { mountLobby } from './lobby-view'
import { mountMembers } from './members-view'
import { mountSurface } from './surface'
import type { FoliumPanelContext } from '../../vendor/folium/contract'
import type { PartyController } from './controller'
import { button, el } from './dom'
import { mountRoomChat } from './room-chat'
import { t } from './i18n'

// src/client/panel.ts
export function mountPanel(
  container: HTMLElement,
  controller: PartyController,
  context?: FoliumPanelContext,
) {
  const { root, page, dispose: disposeSurface } = mountSurface(container, 'mp-panel', context)
  const header = el('header', 'mp-header')
  header.append(el('h2', '', t('一起听')))
  const badge = el('span', 'mp-pill', t('多人房间'))
  header.append(badge)
  const nav = el('nav', 'mp-nav')
  nav.setAttribute('role', 'tablist')
  nav.setAttribute('aria-label', t('一起听功能'))
  const sections = ['房间', '成员', '聊天'].map((name) => {
    const node = el('section', 'mp-view')
    node.setAttribute('aria-label', t(name))
    return node
  })
  const [roomView, memberView, chatView] = sections
  roomView.classList.add('mp-room-view')
  memberView.classList.add('mp-members-view')
  chatView.classList.add('mp-chat-view')
  const membersView = mountMembers(memberView, controller)
  const chat = mountRoomChat(chatView, controller)
  let tab = 0
  const tabs = sections.map((section, i) => {
    const pick = button(t(['房间', '成员', '聊天'][i]), () => {
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
    chat.show(tab === 2)
  }
  const prerequisite = el('div', 'mp-error', t('请升级到 Folia 0.7.13，以支持退出房间时继续播放。'))
  const lobby = mountLobby(controller)
  const active = el('section', 'mp-lobby-card mp-room-card'),
    roomDetails = el('dl', 'mp-room-details')
  const share = el('footer', 'mp-row mp-room-footer')
  share.append(
    button(
      t('复制邀请链接'),
      () =>
        void controller.run(async () => {
          await navigator.clipboard.writeText(controller.shareLink())
          controller.patch({ notice: t('邀请链接已复制') })
        }),
      'mp-command',
    ),
    button(t('私信邀请'), () => controller.folium.ui.openHomeTab('private')),
    button(t('退出房间'), () => void controller.run(() => controller.leave()), 'danger mp-command'),
  )
  active.append(el('h3', '', t('房间信息')), roomDetails)
  roomView.append(prerequisite, active, lobby.node, share)

  page.append(header, nav, ...sections)
  function render() {
    const state = controller.state,
      room = state.room
    badge.textContent = room
      ? t('{count} 人一起听', { count: room.onlineCount ?? room.members.length })
      : t('多人房间')
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
        field(t('在线成员'), t('{count} 人', { count: room.onlineCount ?? room.members.length })),
        ...(creator?.nickname ? [field(t('创建者'), creator.nickname)] : []),
        ...(room.tags?.length ? [field(t('音乐标签'), room.tags.join(' · '))] : []),
      )
    }
    root.querySelectorAll<HTMLButtonElement>('.mp-command').forEach((command) => {
      command.disabled = state.busy
    })
    lobby.render()
  }
  const stop = controller.subscribe(render),
    stopSong = controller.folium.events.on('playback.songChanged', render)
  render()
  return () => {
    stop()
    stopSong()
    chat.dispose()
    membersView.dispose()
    lobby.dispose()
    disposeSurface()
  }
}
