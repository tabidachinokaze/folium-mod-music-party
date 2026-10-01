import type { Folium } from './host'
import { mediaUrl } from '@party/shared/message-content'
import type { ChatMessage, PrivateMessage } from '@party/shared/types'

// src/client/dom.ts
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag)
  node.className = className
  if (text) node.textContent = text
  return node
}
export function button(label: string, action: () => void, className = '') {
  const node = el('button', `mp-button ${className}`, label)
  node.type = 'button'
  node.addEventListener('click', action)
  return node
}
const actionIcons = {
  refresh: 'refresh-cw',
  back: 'arrow-left',
  top: 'arrow-up-to-line',
  delete: 'trash-2',
} as const
export function iconButton(
  ui: Folium['ui'],
  label: string,
  icon: keyof typeof actionIcons,
  action: () => void,
  className = '',
) {
  const node = button('', action, `mp-icon-button ${className}`)
  node.setAttribute('aria-label', label)
  node.title = label
  void ui
    .icon(actionIcons[icon], { size: 14 })
    .then((svg) => {
      if (svg) {
        svg.setAttribute('aria-hidden', 'true')
        node.append(svg)
      } else node.textContent = label
    })
    .catch(() => {
      node.textContent = label
    })
  return node
}
export function picture(url: string, label = '') {
  const img = el('img', 'mp-image')
  const safe = mediaUrl(url)
  if (safe) img.src = safe
  else img.hidden = true
  img.addEventListener(
    'error',
    () => {
      img.hidden = true
    },
    { once: true },
  )
  img.alt = label
  img.loading = 'lazy'
  img.referrerPolicy = 'no-referrer'
  return img
}
export function messageNode(message: ChatMessage | PrivateMessage, mine: boolean) {
  const row = el('article', `mp-message ${mine ? 'is-mine' : ''}`)
  const nickname = 'nickname' in message ? message.nickname : mine ? '我' : '听友'
  row.append(
    el(
      'div',
      'mp-meta',
      `${nickname} · ${new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    ),
  )
  const attachments = message.attachments || []
  const emoji = 'emoji' in message ? message.emoji : undefined
  const text = message.text?.trim() || ''
  // API fallback labels describe media; they are not a second text message.
  const placeholder =
    (attachments.length > 0 || emoji) &&
    (/^(?:\[?(?:图片|图片消息|表情|表情包|语音|音频|视频|文件)\]?|\[分享(?:歌曲|歌单|专辑)\].*)$/.test(
      text,
    ) ||
      attachments.some((item) => text === item.title || text === `[${item.title}]`) ||
      (emoji && (text === emoji.emojiName || text === `[${emoji.emojiName}]`)) ||
      (attachments.some((item) => item.kind === 'file') && text.startsWith('[文件] ')))
  if (text && !placeholder) row.append(el('p', 'mp-bubble', message.text))
  if (emoji && !attachments.some((item) => item.url === emoji.emojiImgUrl)) {
    const image = picture(emoji.emojiImgUrl, emoji.emojiName)
    image.style.aspectRatio = `${emoji.width} / ${emoji.height}`
    row.append(image)
  }
  for (const item of message.attachments || []) {
    if (item.kind === 'image' && item.url) row.append(picture(item.url, '图片消息'))
    else if ((item.kind === 'audio' || item.kind === 'video') && item.url) {
      const media = el(item.kind === 'audio' ? 'audio' : 'video', 'mp-media')
      const safe = mediaUrl(item.url)
      if (safe) {
        media.src = safe
        media.controls = true
        media.preload = 'none'
        row.append(media)
      }
    } else
      row.append(
        el(
          'div',
          'mp-resource',
          'title' in item ? String(item.title || '分享的内容') : '收到一条附件消息',
        ),
      )
  }
  return row
}
