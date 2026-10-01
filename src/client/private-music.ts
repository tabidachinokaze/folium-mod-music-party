import type { MessageAttachment, PrivateMessage } from '@party/shared/types'
import { el, picture } from './dom'
import { t } from './i18n'

// src/client/private-music.ts
const isMusic = (item: MessageAttachment) =>
  item.kind === 'resource' && (item.resourceType === 'song' || item.resourceType === 'album')

function musicResource(item: MessageAttachment) {
  const resource = el('div', 'mp-private-music-resource'),
    cover = el('span', 'mp-private-music-cover', '♪'),
    info = el('div', 'mp-private-music-info'),
    heading = el('div', 'mp-private-music-heading')
  resource.dataset.resourceType = item.resourceType
  if (item.resourceId) resource.dataset.resourceId = item.resourceId
  cover.setAttribute('aria-hidden', 'true')
  if (item.cover) cover.append(picture(item.cover))
  heading.append(
    el('span', 'mp-private-music-kind', t(item.resourceType === 'album' ? '专辑' : '单曲')),
    el('strong', 'mp-private-music-title', item.title),
  )
  info.append(heading)
  if (item.artist) info.append(el('span', 'mp-private-music-artist', item.artist))
  // Descriptions are separate metadata; they must not replace the actual artist name.
  if (
    item.subtitle &&
    item.subtitle !== item.artist &&
    item.subtitle !== '歌曲' &&
    item.subtitle !== '专辑'
  )
    info.append(el('span', 'mp-private-music-note', item.subtitle))
  resource.append(cover, info)
  return resource
}

/** Keep a message caption and all its song/album metadata inside a single shared message card. */
export function decoratePrivateMusic(row: HTMLElement, message: PrivateMessage) {
  // The shared renderer creates generic resource nodes for these same attachment cases.
  const fallbackAttachments = (message.attachments || []).filter(
    (item) => !(['image', 'audio', 'video'].includes(item.kind) && item.url),
  )
  const resources = Array.from(row.querySelectorAll<HTMLElement>(':scope > .mp-resource'))
  const music = fallbackAttachments.flatMap((item, index) =>
    isMusic(item) && resources[index] ? [{ item, node: resources[index] }] : [],
  )
  if (!music.length) return
  const caption = row.querySelector<HTMLElement>(':scope > .mp-bubble'),
    card = el('section', 'mp-private-music-message')
  card.setAttribute('aria-label', t('音乐分享'))
  ;(caption ?? music[0].node).before(card)
  if (caption) {
    caption.classList.replace('mp-bubble', 'mp-private-music-caption')
    card.append(caption)
  }
  for (const { item, node } of music) {
    card.append(musicResource(item))
    node.remove()
  }
}
