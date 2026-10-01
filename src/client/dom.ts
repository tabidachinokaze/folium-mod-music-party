import type { Folium } from './host'
import { mediaUrl } from '@party/shared/message-content'
import type { ChatMessage, PrivateMessage } from '@party/shared/types'
import { roomActivityPresentation } from './room-activity-presentation'
import { messageTime } from './message-time'
import { t } from './i18n'

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
        node.prepend(svg)
      } else node.prepend(document.createTextNode(label))
    })
    .catch(() => {
      node.prepend(document.createTextNode(label))
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
const activityIcons = new WeakMap<Folium['ui'], Map<string, Promise<SVGSVGElement | null>>>()
function activityIcon(ui: Folium['ui'] | undefined, name: string) {
  const node = el('span', 'mp-activity-icon')
  node.setAttribute('aria-hidden', 'true')
  if (ui) {
    let cache = activityIcons.get(ui)
    if (!cache) activityIcons.set(ui, (cache = new Map()))
    let icon = cache.get(name)
    if (!icon) {
      icon = ui.icon(name, { size: 13, strokeWidth: 1.8 }).catch(() => null)
      cache.set(name, icon)
    }
    void icon.then((svg) => {
      if (svg) node.append(svg.cloneNode(true))
    })
  }
  return node
}
export function messageNode(
  message: ChatMessage | PrivateMessage,
  mine: boolean,
  ui?: Folium['ui'],
) {
  const secondary =
    'roomId' in message && !message.emoji && message.kind !== 'text' && message.kind !== 'image'
  if (secondary) {
    const activity = roomActivityPresentation(message)
    const row = el('article', 'mp-message mp-message-secondary')
    row.dataset.messageId = message.id
    row.dataset.activity = activity.type
    const content = el('div', 'mp-activity-content'),
      heading = el('div', 'mp-activity-heading'),
      body = el('p', 'mp-activity-body')
    heading.append(el('span', 'mp-activity-type', t(activity.label)))
    const time = messageTime(message.time)
    time.classList.add('mp-activity-time')
    heading.append(time)
    for (const part of activity.parts) {
      body.append(el('span', `mp-activity-${part.kind}`, part.text))
    }
    content.append(heading, body)
    row.append(activityIcon(ui, activity.icon), content)
    return row
  }
  const row = el('article', `mp-message ${mine ? 'is-mine' : ''}`)
  row.dataset.messageId = message.id
  const nickname = 'nickname' in message ? message.nickname : mine ? t('我') : t('听友')
  const meta = el('div', 'mp-meta', `${nickname} · `)
  meta.append(messageTime(message.time))
  row.append(meta)
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
    if (item.kind === 'image' && item.url) row.append(picture(item.url, t('图片消息')))
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
          'title' in item ? String(item.title || t('分享的内容')) : t('收到一条附件消息'),
        ),
      )
  }
  return row
}
