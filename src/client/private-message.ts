import type { MultiInvitation, PrivateMessage } from '@party/shared/types'
import { button, el, messageNode, picture } from './dom'
import { messageTime } from './message-time'
import { t } from './i18n'

// src/client/private-message.ts
export interface PrivateProfile {
  uid: string
  nickname: string
  avatar: string
}

/** Only use participant profiles attached to messages from this exact conversation. */
export function privateMessageProfiles(
  body: unknown,
  selfUid: string,
  peerUid: string,
): Map<string, PrivateProfile> {
  const profiles = new Map<string, PrivateProfile>()
  const raw = body as { msgs?: any[] } | null
  if (!Array.isArray(raw?.msgs)) return profiles
  for (const message of raw.msgs) {
    const from = String(message?.fromUser?.userId ?? ''),
      to = String(message?.toUser?.userId ?? '')
    if (!((from === selfUid && to === peerUid) || (from === peerUid && to === selfUid))) continue
    for (const profile of [message.fromUser, message.toUser]) {
      const uid = String(profile.userId),
        previous = profiles.get(uid)
      profiles.set(uid, {
        uid,
        nickname:
          typeof profile.nickname === 'string' && profile.nickname.trim()
            ? profile.nickname
            : previous?.nickname || '',
        avatar:
          typeof profile.avatarUrl === 'string' && profile.avatarUrl
            ? profile.avatarUrl
            : previous?.avatar || '',
      })
    }
  }
  return profiles
}

export function privateMessageNode(
  message: PrivateMessage,
  mine: boolean,
  profile: PrivateProfile,
  join: (link: MultiInvitation) => void,
) {
  const row = messageNode(message, mine),
    content = el('div', 'mp-message-content'),
    avatar = el('span', 'mp-avatar mp-message-avatar')
  row.classList.add('mp-message-primary', 'mp-private-message')
  avatar.setAttribute('role', 'img')
  avatar.setAttribute('aria-label', t('{name}的头像', { name: profile.nickname }))
  avatar.append(el('span', '', Array.from(profile.nickname)[0] || '♪'))
  if (profile.avatar) avatar.append(picture(profile.avatar, ''))
  const meta = row.querySelector('.mp-meta')
  meta?.replaceChildren(
    el('span', 'mp-private-author', profile.nickname),
    messageTime(message.time),
  )
  content.append(...row.childNodes)
  row.append(avatar, content)
  // An invitation is one message card: caption and action belong to that same content block.
  const caption = message.invitations.length ? content.querySelector('.mp-bubble') : null
  message.invitations.forEach((link, index) => {
    const card = el('section', 'mp-private-invitation'),
      heading = el('div', 'mp-private-invitation-heading'),
      icon = el('span', 'mp-private-invitation-icon', '♪')
    icon.setAttribute('aria-hidden', 'true')
    card.setAttribute('aria-label', t('多人一起听邀请'))
    heading.append(icon, el('strong', '', t('一起听歌')))
    card.append(heading)
    if (index === 0 && caption) {
      const description = el('p', 'mp-private-invitation-description', caption.textContent || '')
      card.append(description)
      caption.remove()
    }
    card.append(button(t('加入多人房间'), () => join(link), 'mp-private-invitation-join'))
    content.append(card)
  })
  return row
}
