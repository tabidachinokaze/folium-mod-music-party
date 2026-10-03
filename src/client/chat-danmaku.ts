import type { ChatMessage } from '@party/shared/types'
import { mediaUrl } from '@party/shared/message-content'
import type { PartyController } from './controller'
import { el } from './dom'
import { t } from './i18n'
import { roomActivityPresentation } from './room-activity-presentation'
import { ChatMessageFeed } from './chat-message-feed'
import Danmaku from 'danmaku/dist/esm/danmaku.dom.js'
import { DanmakuClock } from './chat-danmaku-clock'
import { danmakuPreviewImage, danmakuPreviewMessages } from './chat-danmaku-preview'
import { danmakuDefaults, type DanmakuPreferenceValues } from './chat-preferences'
import {
  DanmakuFilter,
  DanmakuQueue,
  DanmakuTracks,
  danmakuCategory,
  danmakuGeometry,
} from './chat-danmaku-layout'
import css from './chat-danmaku.css'

function renderMessage(message: ChatMessage, preview = false) {
  const attachments = message.attachments || [],
    secondary = danmakuCategory(message) === 'activity',
    row = el('div', `mp-danmaku-message${secondary ? ' mp-danmaku-secondary' : ''}`)
  row.dataset.messageId = message.id
  row.dataset.kind = secondary ? 'activity' : message.emoji ? 'sticker' : message.kind
  if (preview) {
    row.dataset.preview = 'true'
    row.append(el('span', 'mp-danmaku-preview-label', t('预览')))
  }
  if (secondary) {
    const activity = roomActivityPresentation(message)
    row.append(el('span', 'mp-danmaku-text', activity.text))
  } else {
    if (message.nickname) row.append(el('span', 'mp-danmaku-author', `${message.nickname}:`))
    const text = message.text.trim(),
      media = !!message.emoji || attachments.length > 0,
      placeholder =
        media &&
        (/^(?:\[?(?:图片|图片消息|表情|表情包|语音|音频|视频|文件)\]?|[（(]?升级\s*App\s*到最新版本即可查看该消息[）)]?)$/i.test(
          text,
        ) ||
          text === message.emoji?.emojiName ||
          text === `[${message.emoji?.emojiName}]` ||
          attachments.some((item) => text === item.title || text === `[${item.title}]`))
    if (text && !placeholder) row.append(el('span', 'mp-danmaku-text', text.slice(0, 500)))
  }
  const images = new Set<string>(),
    addImage = (url: string | undefined, label: string) => {
      const safe = preview && url === danmakuPreviewImage ? url : url ? mediaUrl(url) : ''
      if (!safe || images.has(safe) || images.size >= 2) return
      images.add(safe)
      const image = el('img', 'mp-danmaku-image')
      image.src = safe
      image.alt = label
      image.referrerPolicy = 'no-referrer'
      image.addEventListener('error', () => image.remove(), { once: true })
      row.append(image)
    }
  addImage(message.emoji?.emojiImgUrl, message.emoji?.emojiName || t('表情包'))
  for (const item of attachments) {
    if (item.kind === 'image') addImage(item.url, item.title || t('图片'))
    else {
      addImage(item.cover, item.title)
      if (!secondary)
        row.append(
          el(
            'span',
            'mp-danmaku-text',
            item.title || t(item.kind === 'video' ? '视频' : '分享的内容'),
          ),
        )
    }
  }
  return row
}

export function mountDanmaku(
  container: HTMLElement,
  controller: PartyController,
  configuration: { preview?: boolean } = {},
) {
  const preview = configuration.preview === true
  const host = el('div', 'mp-danmaku-host'),
    root = host.attachShadow({ mode: 'open' }),
    style = el('style'),
    stage = el('div', 'mp-danmaku'),
    feed = preview ? null : new ChatMessageFeed(),
    filter = new DanmakuFilter(),
    queue = preview ? new DanmakuQueue<ChatMessage>(3, 120000) : new DanmakuQueue<ChatMessage>(),
    motion = matchMedia('(prefers-reduced-motion: reduce)')
  type FlyingMessage = {
    id: string
    node: HTMLElement
    row: HTMLElement
    clock: DanmakuClock
    engine: Danmaku
    duration: number
    timer?: ReturnType<typeof setTimeout>
  }
  const flying = new Map<string, FlyingMessage>()
  style.textContent = css
  host.setAttribute('aria-hidden', 'true')
  if (preview) host.dataset.preview = 'true'
  root.append(style, stage)
  container.append(host)
  let enabled = false,
    visible = true,
    disposed = false,
    width = 0,
    height = 0,
    scope = '',
    previewBatch = 0,
    previewTimer: ReturnType<typeof setTimeout> | undefined,
    options: DanmakuPreferenceValues = { ...danmakuDefaults },
    geometry = danmakuGeometry(0, 0, options),
    tracks = new DanmakuTracks(0)
  const active = () => enabled && visible && !document.hidden && !disposed
  const finish = (item: FlyingMessage, drain = true) => {
    if (flying.get(item.id) !== item) return
    flying.delete(item.id)
    clearTimeout(item.timer)
    item.engine.destroy()
    item.clock.pause()
    item.node.remove()
    tracks.release(item.id)
    if (drain) {
      pump()
      if (preview && active() && !flying.size && !queue.peek(performance.now())) {
        clearTimeout(previewTimer)
        previewTimer = setTimeout(restart, 600)
      }
    }
  }
  const scheduleEnd = (item: FlyingMessage) => {
    clearTimeout(item.timer)
    if (item.clock.paused) return
    item.timer = setTimeout(
      () => finish(item),
      Math.max(40, (item.duration - item.clock.currentTime) * 1000 + 40),
    )
  }
  const applyStyle = () => {
    geometry = danmakuGeometry(width, height, options, motion.matches)
    tracks = new DanmakuTracks(geometry.rows)
    stage.dataset.mode = motion.matches ? 'top' : options.danmakuMode
    stage.dataset.textStyle = options.danmakuTextStyle
    stage.style.height = `${geometry.height}px`
    stage.style.opacity = String(options.danmakuOpacity / 100)
    stage.style.setProperty('--mp-danmaku-size', `${geometry.fontSize}px`)
    stage.style.setProperty('--mp-danmaku-image-size', `${geometry.imageSize}px`)
    stage.style.setProperty('--mp-danmaku-line-height', `${geometry.lineHeight}px`)
    stage.style.setProperty('--mp-danmaku-weight', options.danmakuBold ? '600' : '400')
    stage.style.setProperty(
      '--mp-danmaku-font',
      {
        system: 'var(--folium-font, system-ui), sans-serif',
        heiti: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
        songti: '"SimSun", "Songti SC", "Noto Serif CJK SC", serif',
      }[options.danmakuFont],
    )
  }
  const clear = () => {
    clearTimeout(previewTimer)
    previewTimer = undefined
    queue.clear()
    filter.clear()
    for (const item of flying.values()) finish(item, false)
    applyStyle()
  }
  const pump = () => {
    if (!active() || width <= 0 || height <= 0) return
    let message = queue.peek(performance.now())
    while (message) {
      const lane = tracks.claim(message.id, options.danmakuOverlap)
      if (lane === null) return
      queue.shift()
      const node = el('div', 'mp-danmaku-track'),
        row = renderMessage(message, preview),
        clock = new DanmakuClock(),
        mode = motion.matches ? 'top' : options.danmakuMode
      node.dataset.lane = String(lane)
      node.dataset.mode = mode
      node.style.top = `${
        mode === 'bottom'
          ? geometry.height - (lane + 1) * geometry.lineHeight - 1
          : lane * geometry.lineHeight
      }px`
      node.style.height = `${geometry.lineHeight + 1}px`
      row.style.maxWidth = `${Math.max(0, Math.min(560, width - 24))}px`
      row.dataset.paused = 'false'
      stage.append(node)
      // One public engine instance per occupied track gives each comment an
      // independent lifetime. Pausing one never advances or removes it, and
      // exclusive tracks keep later messages from running into the paused tail.
      const engine = new Danmaku({
        container: node,
        media: clock as unknown as HTMLMediaElement,
        comments: [],
        speed: geometry.speed,
      })
      const item: FlyingMessage = {
        id: message.id,
        node,
        row,
        clock,
        engine,
        duration: geometry.duration,
      }
      flying.set(item.id, item)
      row.addEventListener('pointerenter', () => {
        if (flying.get(item.id) !== item) return
        clock.pause()
        clearTimeout(item.timer)
        row.dataset.paused = 'true'
      })
      row.addEventListener('pointerleave', () => {
        if (flying.get(item.id) !== item || !active()) return
        row.dataset.paused = 'false'
        clock.play()
        scheduleEnd(item)
      })
      engine.emit({ mode: mode === 'scroll' ? 'rtl' : mode, render: () => row })
      clock.play()
      scheduleEnd(item)
      message = queue.peek(performance.now())
    }
  }
  const restart = () => {
    clear()
    if (!preview || !active() || width <= 0 || height <= 0 || !geometry.rows) return
    const now = performance.now()
    queue.push(filter.take(danmakuPreviewMessages(++previewBatch), options, now), now)
    pump()
  }
  const update = () => {
    if (preview) {
      restart()
      return
    }
    const state = controller.state,
      nextScope = `${state.account?.uid || ''}:${state.room?.roomId || ''}`
    if (nextScope !== scope || !active()) clear()
    scope = nextScope
    const fresh = feed!.take(state, active())
    if (!fresh.length) return
    queue.push(filter.take(fresh, options, performance.now()), performance.now())
    pump()
  }
  const resize = new ResizeObserver(() => {
    const rect = host.getBoundingClientRect()
    if (rect.width === width && rect.height === height) return
    width = rect.width
    height = rect.height
    restart()
  })
  resize.observe(host)
  const onVisibility = () => update(),
    onMotion = () => restart()
  document.addEventListener('visibilitychange', onVisibility)
  motion.addEventListener('change', onMotion)
  const unsubscribe = preview ? () => {} : controller.subscribe(update),
    language = preview ? new MutationObserver(restart) : null
  language?.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  const initialBounds = host.getBoundingClientRect()
  width = initialBounds.width
  height = initialBounds.height
  clear()
  update()
  return {
    setOptions(value: DanmakuPreferenceValues) {
      if (
        disposed ||
        Object.keys(danmakuDefaults).every(
          (key) =>
            options[key as keyof DanmakuPreferenceValues] ===
            value[key as keyof DanmakuPreferenceValues],
        )
      )
        return
      options = { ...value }
      restart()
    },
    setEnabled(value: boolean) {
      if (value === enabled || disposed) return
      enabled = value
      update()
    },
    setVisible(value: boolean) {
      if (value === visible || disposed) return
      visible = value
      update()
    },
    dispose() {
      if (disposed) return
      disposed = true
      clear()
      unsubscribe()
      resize.disconnect()
      language?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      motion.removeEventListener('change', onMotion)
      host.remove()
    },
  }
}
