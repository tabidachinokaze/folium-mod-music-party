import type { ChatMessage, Member } from '@party/shared/types'
import { button, el, picture } from './dom'
import { messageTime } from './message-time'
import { t } from './i18n'

// src/client/room-message.ts
// Official multiplayer chat carries mentions as @nickname text, not recipient IDs.
export function decorateRoomMessage(
  row: HTMLElement,
  message: ChatMessage,
  viewerNickname: string,
  mention: (member: Member) => void,
) {
  if (!row.classList.contains('mp-message-secondary')) {
    row.classList.add('mp-message-primary')
    const content = el('div', 'mp-message-content'),
      avatar = el('span', 'mp-avatar mp-message-avatar')
    avatar.setAttribute('aria-label', t('{name}的头像', { name: message.nickname }))
    avatar.setAttribute('role', 'img')
    avatar.append(el('span', '', Array.from(message.nickname)[0] || '♪'))
    if (message.avatar) avatar.append(picture(message.avatar, ''))
    content.append(...row.childNodes)
    row.append(avatar, content)
  }
  const author = () => {
    const node = button(
      message.nickname,
      () => mention({ uid: message.uid, nickname: message.nickname, avatar: message.avatar }),
      'mp-message-author',
    )
    node.setAttribute('aria-label', t('提及 {name}', { name: message.nickname }))
    node.title = `@${message.nickname}`
    return node
  }
  const activityActor = row.querySelector('.mp-activity-actor')
  if (activityActor) {
    const node = author()
    node.classList.add('mp-activity-actor')
    activityActor.replaceWith(node)
  }
  const meta = row.querySelector('.mp-meta')
  if (meta) {
    meta.replaceChildren(author(), document.createTextNode(' · '), messageTime(message.time))
  }
  const bubble = row.querySelector('.mp-bubble')
  if (!bubble) return
  const text = message.text
  const parts: Node[] = []
  let offset = 0,
    mentionsMe = false
  for (const match of text.matchAll(/@([^@\s]+)/gu)) {
    parts.push(document.createTextNode(text.slice(offset, match.index)))
    const self = !!viewerNickname && match[1] === viewerNickname
    parts.push(el('span', `mp-mention${self ? ' mp-mention-self' : ''}`, match[0]))
    mentionsMe ||= self
    offset = match.index + match[0].length
  }
  if (!offset) return
  parts.push(document.createTextNode(text.slice(offset)))
  bubble.replaceChildren(...parts)
  if (mentionsMe) {
    row.classList.add('mp-mentioned')
    meta?.append(el('span', 'mp-mention-badge', t('提到了你')))
  }
}
