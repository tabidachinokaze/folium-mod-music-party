import type { MessageAttachment, PrivateMessage } from '@party/shared/types'
import { el, picture } from './dom'
import { t } from './i18n'

// src/client/private-music.ts
export interface PrivateResourceActions {
  canActivate(item: MessageAttachment): boolean
  label(item: MessageAttachment): string
  activate(item: MessageAttachment): Promise<void>
}

const isMusic = (item: MessageAttachment) =>
  item.resourceType === 'song' || item.resourceType === 'album'
const resourceLabels: Record<string, string> = {
  song: '单曲',
  album: '专辑',
  playlist: '歌单',
  artist: '歌手',
  program: '播客节目',
  radio: '播客',
  mv: 'MV',
  video: '视频',
  user: '用户',
  topic: '话题',
  event: '动态',
  mlog: 'Mlog',
  concert: '演出',
  live: '直播',
  comment: '评论',
  general: '消息卡片',
}

export function privateResourceLabel(item: MessageAttachment) {
  return !isMusic(item) && item.label
    ? item.label
    : t(resourceLabels[item.resourceType || ''] || '分享')
}

/** One explicit activation at a time; detached or no-longer-supported cards do nothing. */
export function createPrivateResourceActivation(
  item: MessageAttachment,
  actions: PrivateResourceActions,
  available: () => boolean,
  setBusy: (busy: boolean) => void,
) {
  let busy = false
  return async () => {
    if (busy || !available() || !actions.canActivate(item)) return
    busy = true
    setBusy(true)
    try {
      await actions.activate(item)
    } finally {
      busy = false
      setBusy(false)
    }
  }
}

function resourceNode(item: MessageAttachment, actions?: PrivateResourceActions) {
  const actionable = !!actions?.canActivate(item),
    resource = el(actionable ? 'button' : 'div', 'mp-private-music-resource mp-private-resource'),
    cover = el('span', 'mp-private-music-cover', isMusic(item) ? '♪' : '▧'),
    info = el('span', 'mp-private-music-info'),
    heading = el('span', 'mp-private-music-heading')
  if (item.resourceType) resource.dataset.resourceType = item.resourceType
  if (item.resourceId) resource.dataset.resourceId = item.resourceId
  cover.setAttribute('aria-hidden', 'true')
  if (item.cover) cover.append(picture(item.cover))
  heading.append(
    el('span', 'mp-private-music-kind', privateResourceLabel(item)),
    el('strong', 'mp-private-music-title', item.title),
  )
  info.append(heading)
  if (item.artist) info.append(el('span', 'mp-private-music-artist', item.artist))
  // Descriptions remain independent of the artist, and fallback type labels are not captions.
  if (
    item.subtitle &&
    item.subtitle !== item.artist &&
    item.subtitle !== item.label &&
    item.subtitle !== item.title &&
    item.subtitle !== '歌曲' &&
    item.subtitle !== resourceLabels[item.resourceType || '']
  )
    info.append(el('span', 'mp-private-music-note', item.subtitle))
  resource.append(cover, info)
  if (actionable && actions) {
    const button = resource as HTMLButtonElement
    button.type = 'button'
    const updateLabel = () => {
      const label = actions.label(item)
      button.setAttribute('aria-label', label)
      button.title = label
    }
    updateLabel()
    button.addEventListener('focus', updateLabel)
    button.addEventListener('pointerenter', updateLabel)
    const activate = createPrivateResourceActivation(
      item,
      actions,
      () => button.isConnected,
      (busy) => {
        button.disabled = busy
        button.setAttribute('aria-busy', String(busy))
      },
    )
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      updateLabel()
      // The host adapter reports failures using toast. Keep rejected actions out of the event loop.
      void activate().catch(() => {})
    })
  }
  return resource
}

/** All content of one shared-resource message keeps its original order inside one card. */
export function decoratePrivateMusic(
  row: HTMLElement,
  message: PrivateMessage,
  actions?: PrivateResourceActions,
) {
  // The shared renderer creates generic resource nodes for these same attachment cases.
  const fallbackAttachments = (message.attachments || []).filter(
    (item) => !(['image', 'audio', 'video'].includes(item.kind) && item.url),
  )
  const placeholders = Array.from(row.querySelectorAll<HTMLElement>(':scope > .mp-resource'))
  const resources = fallbackAttachments.flatMap((item, index) =>
    item.kind === 'resource' && placeholders[index] ? [{ item, node: placeholders[index] }] : [],
  )
  if (!resources.length) return
  for (const { item, node } of resources) node.replaceWith(resourceNode(item, actions))

  const caption = row.querySelector<HTMLElement>(':scope > .mp-bubble'),
    body = Array.from(row.children).filter((node) => !node.classList.contains('mp-meta')),
    card = el('section', 'mp-private-music-message mp-private-resource-message')
  card.setAttribute(
    'aria-label',
    t(resources.every(({ item }) => isMusic(item)) ? '音乐分享' : '资源分享'),
  )
  caption?.classList.replace('mp-bubble', 'mp-private-music-caption')
  body[0].before(card)
  card.append(...body)
}
