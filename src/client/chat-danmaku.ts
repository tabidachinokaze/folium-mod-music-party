import type { ChatMessage } from '@party/shared/types'
import { mediaUrl } from '@party/shared/message-content'
import type { PartyController } from './controller'
import { el } from './dom'
import { t } from './i18n'
import { roomActivityPresentation } from './room-activity-presentation'
import { ChatMessageFeed } from './chat-message-feed'
import { DanmakuLanes, DanmakuQueue } from './chat-danmaku-layout'
import css from './chat-danmaku.css'

function renderMessage(message: ChatMessage) {
  const attachments = message.attachments || [],
    secondary = !message.emoji && message.kind !== 'text' && message.kind !== 'image',
    row = el('div', `mp-danmaku-message${secondary ? ' mp-danmaku-secondary' : ''}`)
  row.dataset.messageId = message.id
  row.dataset.kind = secondary ? 'activity' : message.emoji ? 'sticker' : message.kind
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
      const safe = url ? mediaUrl(url) : ''
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

export function mountDanmaku(container: HTMLElement, controller: PartyController) {
  const host = el('div', 'mp-danmaku-host'),
    root = host.attachShadow({ mode: 'open' }),
    style = el('style'),
    stage = el('div', 'mp-danmaku'),
    feed = new ChatMessageFeed(),
    queue = new DanmakuQueue<ChatMessage>(),
    motion = matchMedia('(prefers-reduced-motion: reduce)'),
    animations = new Map<HTMLElement, Animation>()
  style.textContent = css
  host.setAttribute('aria-hidden', 'true')
  root.append(style, stage)
  container.append(host)
  let enabled = false,
    visible = true,
    disposed = false,
    width = 0,
    height = 0,
    scope = '',
    lanes = new DanmakuLanes(0),
    timer: ReturnType<typeof setTimeout> | undefined
  const active = () => enabled && visible && !document.hidden && !disposed
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
    queue.clear()
    for (const [node, animation] of animations) {
      animation.cancel()
      node.remove()
    }
    animations.clear()
    lanes = new DanmakuLanes(
      Math.min(8, Math.max(0, Math.floor((height * 0.55 - 24) / 54))),
      Math.max(90, width / 9),
    )
  }
  const pump = () => {
    clearTimeout(timer)
    timer = undefined
    if (!active() || width <= 0 || height <= 0) return
    let now = performance.now(),
      message = queue.peek(now)
    while (message) {
      const delay = lanes.delay(now)
      if (delay > 0) {
        if (Number.isFinite(delay)) timer = setTimeout(pump, Math.max(30, delay))
        return
      }
      const row = renderMessage(message)
      row.style.visibility = 'hidden'
      stage.append(row)
      const itemWidth = row.getBoundingClientRect().width,
        slot = lanes.claim(now, itemWidth, width, motion.matches)
      if (!slot) {
        row.remove()
        const delay = lanes.delay(now)
        if (Number.isFinite(delay)) timer = setTimeout(pump, Math.max(30, delay))
        return
      }
      queue.shift()
      row.style.top = `${24 + slot.lane * 54}px`
      row.style.visibility = ''
      row.classList.toggle('mp-danmaku-stationary', motion.matches)
      const opacity = row.classList.contains('mp-danmaku-secondary') ? 0.72 : 1,
        animation = row.animate(
          motion.matches
            ? [{ opacity: 0 }, { opacity, offset: 0.08 }, { opacity, offset: 0.88 }, { opacity: 0 }]
            : [
                { transform: `translateX(${width}px)` },
                { transform: `translateX(${-itemWidth}px)` },
              ],
          { duration: slot.duration, easing: 'linear' },
        )
      animations.set(row, animation)
      const done = () => {
        animations.delete(row)
        row.remove()
      }
      void animation.finished.then(done, done)
      now = performance.now()
      message = queue.peek(now)
    }
  }
  const update = () => {
    const state = controller.state,
      nextScope = `${state.account?.uid || ''}:${state.room?.roomId || ''}`
    if (nextScope !== scope || !active()) clear()
    scope = nextScope
    const fresh = feed.take(state, active())
    if (!fresh.length) return
    queue.push(fresh, performance.now())
    pump()
  }
  const resize = new ResizeObserver(() => {
    const rect = host.getBoundingClientRect()
    if (rect.width === width && rect.height === height) return
    width = rect.width
    height = rect.height
    clear()
  })
  resize.observe(host)
  const onVisibility = () => update(),
    onMotion = () => clear()
  document.addEventListener('visibilitychange', onVisibility)
  motion.addEventListener('change', onMotion)
  const unsubscribe = controller.subscribe(update)
  const initialBounds = host.getBoundingClientRect()
  width = initialBounds.width
  height = initialBounds.height
  clear()
  update()
  return {
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
      document.removeEventListener('visibilitychange', onVisibility)
      motion.removeEventListener('change', onMotion)
      host.remove()
    },
  }
}
