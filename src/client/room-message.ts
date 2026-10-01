import type { ChatMessage, Member } from '@party/shared/types'
import { button, el } from './dom'

// src/client/room-message.ts
// Official multiplayer chat carries mentions as @nickname text, not recipient IDs.
export function decorateRoomMessage(
  row: HTMLElement,
  message: ChatMessage,
  viewerNickname: string,
  mention: (member: Member) => void,
) {
  const author = () => {
    const node = button(
      message.nickname,
      () => mention({ uid: message.uid, nickname: message.nickname, avatar: message.avatar }),
      'mp-message-author',
    )
    node.setAttribute('aria-label', `提及 ${message.nickname}`)
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
    meta.replaceChildren(
      author(),
      document.createTextNode(
        ` · ${new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      ),
    )
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
    meta?.append(el('span', 'mp-mention-badge', '提到了你'))
  }
}
