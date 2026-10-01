import type { PartyController } from './controller'
import { button, el } from './dom'

// src/client/lobby-view.ts
export function mountLobby(controller: PartyController) {
  const node = el('div', 'mp-lobby')
  const card = (title: string, description: string) => {
    const section = el('section', 'mp-lobby-card')
    section.append(el('h3', '', title), el('p', 'mp-muted', description))
    return section
  }
  const existing = card('继续一起听', '你的账号已有一个多人房间')
  const info = el('div', 'mp-room-preview')
  existing.append(
    info,
    button(
      '恢复当前房间',
      () => void controller.run(() => controller.enter('restore')),
      'primary mp-command',
    ),
  )
  const discover = card('开启一场一起听', '用当前网易云歌曲创建房间，或寻找同样喜欢音乐的人。')
  const toggle = el('label', 'mp-stranger-toggle')
  const checkbox = el('input')
  checkbox.type = 'checkbox'
  checkbox.setAttribute('role', 'switch')
  toggle.append(el('span', '', '允许陌生人匹配'), checkbox)
  const actions = el('div', 'mp-row')
  const create = button(
    '用当前歌曲创建',
    () => void controller.run(() => controller.enter('create', '', checkbox.checked)),
    'primary mp-command',
  )
  const match = button(
    '匹配房间',
    () => void controller.run(() => controller.match()),
    'mp-command',
  )
  const cancel = button(
    '取消匹配',
    () => void controller.run(() => controller.cancelMatch()),
    'mp-command',
  )
  const progress = el('p', 'mp-muted')
  progress.setAttribute('role', 'status')
  actions.append(create, match, cancel)
  discover.append(toggle, actions, progress)
  const link = card('加入朋友的房间', '粘贴朋友分享的多人一起听邀请链接。')
  const input = el('textarea', 'mp-invite')
  input.placeholder = '粘贴邀请链接…'
  input.setAttribute('aria-label', '多人邀请链接')
  link.append(
    input,
    button(
      '通过链接加入',
      () => void controller.run(() => controller.enter('join', input.value)),
      'mp-command',
    ),
  )
  const checking = el('p', 'mp-muted', '正在检查当前房间…')
  node.append(checking, existing, discover, link)
  return {
    node,
    render() {
      const state = controller.state
      node.hidden = !state.account || !state.ready
      checking.hidden = !state.checkingRoom
      existing.hidden = !!state.room || !state.availableRoom || state.matching
      const room = state.availableRoom
      if (room) {
        const members = room.members
          .map((member) => member.nickname)
          .filter(Boolean)
          .join('、')
        info.replaceChildren(
          el('strong', '', `${room.onlineCount ?? room.members.length} 人一起听`),
          el('p', 'mp-muted', members || `房间 ${room.roomId}`),
        )
      }
      toggle.hidden = create.hidden = !!state.room || state.matching
      link.hidden = !!state.room || state.matching
      match.hidden = state.matching
      cancel.hidden = !state.matching
      match.textContent = state.room ? '重新匹配' : '匹配房间'
      progress.hidden = !state.matching && !state.room
      progress.textContent = state.matching
        ? '正在寻找房间…'
        : '重新匹配会退出当前房间，寻找新的听友。'
      discover.querySelector('p')!.textContent = state.room
        ? '换一个房间，和新的朋友分享音乐。'
        : '用当前网易云歌曲创建房间，或寻找同样喜欢音乐的人。'
      discover.querySelector('h3')!.textContent = state.room ? '遇见新的听友' : '开启一场一起听'
      for (const control of node.querySelectorAll<HTMLButtonElement>('.mp-command'))
        control.disabled = state.busy || state.checkingRoom
      checkbox.disabled = state.busy
      if (state.availableRoom && !state.room) create.disabled = match.disabled = true
    },
  }
}
