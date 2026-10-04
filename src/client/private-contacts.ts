import type { Conversation } from '@party/shared/types'
import { button, el, picture } from './dom'
import { t } from './i18n'

/** Unknown and offline peers share the original newest-message ordering. */
export function orderPrivateContacts(
  peers: readonly Conversation[],
  online: (uid: string) => boolean | null | undefined,
) {
  return peers
    .map((peer, index) => ({ peer, index, online: online(peer.uid) === true }))
    .sort(
      (a, b) =>
        Number(b.online) - Number(a.online) || b.peer.time - a.peer.time || a.index - b.index,
    )
    .map(({ peer }) => peer)
}

/** Reorder existing rows without recreating avatars, losing focus or moving the reading anchor. */
export function renderPrivateContacts(
  container: HTMLElement,
  peers: readonly Conversation[],
  selected: string | null,
  online: (uid: string) => boolean | null | undefined,
  open: (uid: string) => void,
) {
  const top = container.scrollTop,
    bounds = container.getBoundingClientRect(),
    existing = new Map(
      [...container.querySelectorAll<HTMLButtonElement>('.mp-contact')].map((node) => [
        node.dataset.uid!,
        node,
      ]),
    ),
    focused = (container.getRootNode() as Document | ShadowRoot).activeElement,
    anchor =
      top > 0
        ? [...existing.values()].find(
            (node) => node.getBoundingClientRect().bottom > bounds.top + 1,
          )
        : undefined,
    offset = anchor ? anchor.getBoundingClientRect().top - bounds.top : 0,
    states = new Map(peers.map((peer) => [peer.uid, online(peer.uid) === true])),
    ordered = orderPrivateContacts(peers, (uid) => states.get(uid))
  const empty = container.querySelector('.mp-empty')
  if (ordered.length) empty?.remove()
  let previous: HTMLElement | null = null
  for (const peer of ordered) {
    let row = existing.get(peer.uid)
    if (!row) {
      row = button('', () => open(peer.uid), 'mp-contact')
      row.dataset.uid = peer.uid
      const info = el('span', 'mp-contact-info')
      info.append(el('strong'), el('span', 'mp-contact-preview'))
      row.append(el('span', 'mp-avatar mp-presence-avatar'), info)
    }
    row.setAttribute(
      'aria-label',
      peer.unread
        ? t('{name} · {count} 未读', { name: peer.nickname, count: peer.unread })
        : peer.nickname,
    )
    row.setAttribute('aria-pressed', String(selected === peer.uid))
    const avatar = row.querySelector<HTMLElement>('.mp-avatar')!,
      title = row.querySelector('strong')!,
      preview = row.querySelector('.mp-contact-preview')!
    const profile = JSON.stringify([peer.nickname, peer.avatar])
    if (avatar.dataset.profile !== profile) {
      avatar.dataset.profile = profile
      avatar.replaceChildren(el('span', '', Array.from(peer.nickname)[0] || '♪'))
      if (peer.avatar) avatar.append(picture(peer.avatar, ''))
    }
    let dot = avatar.querySelector('.mp-presence-dot')
    if (states.get(peer.uid) && !dot) {
      dot = el('span', 'mp-presence-dot')
      dot.setAttribute('role', 'img')
      dot.setAttribute('aria-label', t('在线'))
      dot.setAttribute('title', t('在线'))
      avatar.append(dot)
    } else if (!states.get(peer.uid)) dot?.remove()
    if (title.textContent !== peer.nickname) title.textContent = peer.nickname
    const text = peer.preview || t('暂无消息')
    if (preview.textContent !== text) preview.textContent = text
    let badge = row.querySelector('.mp-unread')
    if (peer.unread) {
      if (!badge) row.append((badge = el('span', 'mp-unread')))
      const count = peer.unread > 99 ? '99+' : String(peer.unread)
      if (badge.textContent !== count) badge.textContent = count
    } else badge?.remove()
    const next: Element | null = previous
      ? previous.nextElementSibling
      : container.firstElementChild
    if (next !== row) container.insertBefore(row, next)
    previous = row
    existing.delete(peer.uid)
  }
  for (const row of existing.values()) row.remove()
  if (!ordered.length && !empty) container.append(el('p', 'mp-empty', t('暂无私信会话')))
  if (
    focused instanceof HTMLElement &&
    container.contains(focused) &&
    focused !== (container.getRootNode() as Document | ShadowRoot).activeElement
  )
    focused.focus({ preventScroll: true })
  container.scrollTop =
    anchor?.parentElement === container
      ? container.scrollTop +
        anchor.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        offset
      : top
}
