import type { ChatMessage } from '@party/shared/types'
import { mediaUrl } from '@party/shared/message-content'
import type { PartyController } from './controller'
import { el } from './dom'
import { t } from './i18n'
import { roomActivityPresentation } from './room-activity-presentation'
import { ChatMessageFeed } from './chat-message-feed'
import Danmaku from 'danmaku/dist/esm/danmaku.dom.js'
import { DanmakuClock, danmakuElapsedAtX } from './chat-danmaku-clock'
import { danmakuPreviewImage, danmakuPreviewMessages } from './chat-danmaku-preview'
import { danmakuDefaults, type DanmakuPreferenceValues } from './chat-preferences'
import {
  DanmakuFilter,
  DanmakuQueue,
  DanmakuTracks,
  danmakuCategory,
  danmakuContentEnabled,
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
    const activity = roomActivityPresentation(message),
      actor = activity.parts[0]?.kind === 'actor' ? activity.parts[0] : null
    // Keep the actor outside the shrinkable body, including activity messages
    // that already contain their sender's name. Only the action may ellipsize.
    if (actor) row.append(el('span', 'mp-danmaku-author', actor.text))
    row.append(el('span', 'mp-danmaku-text', activity.text.slice(actor?.text.length || 0)))
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
    message: ChatMessage
    node: HTMLElement
    row: HTMLElement
    clock: DanmakuClock
    engine: Danmaku | null
    mode: 'scroll' | 'top' | 'bottom'
    lane: number
    needsMeasure: boolean
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
    previewCursor = 0,
    options: DanmakuPreferenceValues = { ...danmakuDefaults },
    geometry = danmakuGeometry(0, 0, options),
    tracks = new DanmakuTracks(0)
  const active = () => enabled && visible && !document.hidden && !disposed
  const finish = (item: FlyingMessage, drain = true) => {
    if (flying.get(item.id) !== item) return
    flying.delete(item.id)
    clearTimeout(item.timer)
    item.engine?.destroy()
    item.clock.pause()
    item.node.remove()
    tracks.release(item.id)
    if (drain) {
      if (preview) replenishPreview()
      else pump()
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
    stage.dataset.mode = motion.matches ? 'top' : options.danmakuMode
    stage.dataset.textStyle = options.danmakuTextStyle
    stage.style.height = `${geometry.height}px`
    stage.style.opacity = String(options.danmakuOpacity / 100)
    stage.style.setProperty('--mp-danmaku-size', `${geometry.fontSize}px`)
    stage.style.setProperty('--mp-danmaku-image-size', `${geometry.imageSize}px`)
    stage.style.setProperty('--mp-danmaku-line-height', `${geometry.lineHeight}px`)
    stage.style.setProperty('--mp-danmaku-weight', options.danmakuBold ? '600' : '400')
    stage.style.setProperty(
      '--mp-danmaku-background-opacity',
      String(options.danmakuBackgroundOpacity / 100),
    )
    stage.style.setProperty('--mp-danmaku-hover-opacity', String(options.danmakuHoverOpacity / 100))
    stage.style.setProperty(
      '--mp-danmaku-font',
      {
        system: 'var(--folium-font, system-ui), sans-serif',
        heiti: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
        songti: '"SimSun", "Songti SC", "Noto Serif CJK SC", serif',
      }[options.danmakuFont],
    )
  }
  const placeTrack = (item: FlyingMessage) => {
    item.node.dataset.lane = String(item.lane)
    item.node.dataset.mode = item.mode
    item.node.style.top = `${
      item.mode === 'bottom'
        ? geometry.height - (item.lane + 1) * geometry.lineHeight - 1
        : item.lane * geometry.lineHeight
    }px`
    item.node.style.height = `${geometry.lineHeight + 1}px`
    item.row.style.maxWidth = `${Math.max(0, Math.min(560, width - 24))}px`
  }
  const mountEngine = (item: FlyingMessage, start = false) => {
    const playing = start || !item.clock.paused,
      rect = item.row.getBoundingClientRect(),
      x = start ? width : rect.left - item.node.getBoundingClientRect().left,
      elapsed =
        item.mode === 'scroll'
          ? danmakuElapsedAtX(x, width, rect.width, item.duration)
          : item.clock.currentTime
    clearTimeout(item.timer)
    item.clock.pause()
    item.engine?.destroy()
    item.clock.retime(elapsed)
    // Public resize() does not remeasure a rendered comment. Retain the exact
    // row and its pixel position while a fresh engine measures the new font.
    // This also avoids a blank frame between destroying and emitting it again.
    item.row.style.position = 'absolute'
    item.row.style.left = `${item.mode === 'scroll' ? x : (width - rect.width) / 2}px`
    item.node.append(item.row)
    item.engine = new Danmaku({
      container: item.node,
      media: item.clock as unknown as HTMLMediaElement,
      comments: [],
      speed: geometry.speed,
    })
    item.engine.emit({
      time: 0,
      mode: item.mode === 'scroll' ? 'rtl' : item.mode,
      render: () => {
        item.row.style.position = ''
        item.row.style.left = ''
        return item.row
      },
    })
    item.needsMeasure = false
    if (playing) item.clock.play()
    scheduleEnd(item)
  }
  const clear = () => {
    queue.clear()
    filter.clear()
    for (const item of flying.values()) finish(item, false)
    applyStyle()
    tracks = new DanmakuTracks(geometry.rows)
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
      row.dataset.paused = 'false'
      stage.append(node)
      // One public engine instance per occupied track gives each comment an
      // independent lifetime. Pausing one never advances or removes it, and
      // exclusive tracks keep later messages from running into the paused tail.
      const item: FlyingMessage = {
        id: message.id,
        message,
        node,
        row,
        clock,
        engine: null,
        mode,
        lane,
        needsMeasure: false,
        duration: geometry.duration,
      }
      flying.set(item.id, item)
      if (preview)
        previewCursor = (['text', 'media', 'activity'].indexOf(danmakuCategory(message)) + 1) % 3
      row.addEventListener('pointerenter', () => {
        if (flying.get(item.id) !== item) return
        clock.pause()
        clearTimeout(item.timer)
        row.dataset.paused = 'true'
      })
      row.addEventListener('pointerleave', () => {
        if (flying.get(item.id) !== item || !active()) return
        row.dataset.paused = 'false'
        if (item.needsMeasure) mountEngine(item)
        clock.play()
        scheduleEnd(item)
      })
      placeTrack(item)
      node.append(row)
      mountEngine(item, true)
      message = queue.peek(performance.now())
    }
  }
  const replenishPreview = () => {
    if (!preview || !active() || width <= 0 || height <= 0 || !geometry.rows) return
    // One sample per enabled category, including those waiting for a free lane.
    // A hovered sample does not prevent other categories from looping.
    const present = new Set([...flying.values()].map((item) => danmakuCategory(item.message))),
      batch = danmakuPreviewMessages(++previewBatch),
      samples = [...batch.slice(previewCursor), ...batch.slice(0, previewCursor)].filter(
        (message) =>
          danmakuContentEnabled(message, options) && !present.has(danmakuCategory(message)),
      )
    queue.clear()
    queue.push(samples, performance.now())
    pump()
  }
  const restart = () => {
    clear()
    replenishPreview()
  }
  const reconfigure = (previous: DanmakuPreferenceValues, widthChanged = false) => {
    const oldGeometry = geometry,
      mode = motion.matches ? 'top' : options.danmakuMode,
      measure =
        widthChanged ||
        previous.danmakuFont !== options.danmakuFont ||
        previous.danmakuBold !== options.danmakuBold ||
        previous.danmakuFontSize !== options.danmakuFontSize
    applyStyle()
    const nextTracks = new DanmakuTracks(geometry.rows)
    // Give a hovered row first choice when a smaller area no longer fits all
    // current rows, then retain each surviving row's original lane if possible.
    const ordered = [...flying.values()].sort(
      (a, b) => Number(b.row.dataset.paused === 'true') - Number(a.row.dataset.paused === 'true'),
    )
    for (const item of ordered) {
      const lane = danmakuContentEnabled(item.message, options)
        ? nextTracks.claim(item.id, options.danmakuOverlap, item.lane)
        : null
      if (lane === null) {
        finish(item, false)
        continue
      }
      const modeChanged = item.mode !== mode,
        paused = item.clock.paused
      item.lane = lane
      item.mode = mode
      if (geometry.duration !== item.duration) {
        const progress = item.clock.currentTime / item.duration
        item.clock.pause()
        item.clock.retime(progress * geometry.duration)
        item.duration = geometry.duration
        if (item.engine) item.engine.speed = geometry.speed
        if (!paused) item.clock.play()
      }
      placeTrack(item)
      if (measure || modeChanged || geometry.lineHeight !== oldGeometry.lineHeight) {
        if (paused && !modeChanged) {
          item.needsMeasure = true
          if (item.engine) {
            item.engine.speed = geometry.speed
            item.engine.resize()
          }
        } else mountEngine(item)
      }
      scheduleEnd(item)
    }
    tracks = nextTracks
    queue.retain((message) => danmakuContentEnabled(message, options))
    if (preview) replenishPreview()
    else pump()
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
    const widthChanged = width !== rect.width
    width = rect.width
    height = rect.height
    reconfigure(options, widthChanged)
  })
  resize.observe(host)
  const onVisibility = () => update(),
    onMotion = () => reconfigure(options)
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
      const previous = options
      options = { ...value }
      reconfigure(previous)
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
