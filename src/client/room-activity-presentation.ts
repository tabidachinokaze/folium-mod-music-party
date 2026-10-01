import type { ChatMessage } from '@party/shared/types'
import { roomActivityText } from './room-activity'

// src/client/room-activity-presentation.ts
export interface RoomActivityPart {
  kind: 'text' | 'actor' | 'song'
  text: string
}
export interface RoomActivityPresentation {
  text: string
  type: 'join' | 'recommend' | 'like' | 'leave' | 'notice'
  label: string
  icon: 'user-plus' | 'music-2' | 'thumbs-up' | 'log-out' | 'info'
  parts: RoomActivityPart[]
}
type Span = { start: number; end: number; kind: 'actor' | 'song' }
const events = {
  join: { label: '加入', icon: 'user-plus' },
  recommend: { label: '推荐', icon: 'music-2' },
  like: { label: '点赞', icon: 'thumbs-up' },
  leave: { label: '离开', icon: 'log-out' },
  notice: { label: '动态', icon: 'info' },
} as const

function actorPrefix(body: string, nickname: string) {
  if (!nickname || !body.startsWith(nickname)) return false
  const rest = body.slice(nickname.length)
  return (
    !rest ||
    /^(?:[\s·:：，,]|来了|推荐了|离开了|加入了|退出了|为(?:歌曲|这首歌)|点赞了)/u.test(rest)
  )
}
function eventType(action: string): RoomActivityPresentation['type'] {
  // Classify only the leading action, never a keyword inside a song or arbitrary sentence.
  if (/^(?:来了(?:[\s，,。！!]|$)|加入了(?:房间|一起听)(?:[\s，,。！!]|$))/u.test(action))
    return 'join'
  if (/^推荐了(?:歌曲|一首歌)(?:[\s:：《「“"·]|$)/u.test(action)) return 'recommend'
  if (
    /^(?:点赞了(?:歌曲|这首歌)(?:[\s:：《「“"·]|$)|为(?:歌曲|这首歌)(?:[《「“"].*?[》」”"])?\s*点赞(?:了)?(?:[\s，,。！!]|$))/u.test(
      action,
    )
  )
    return 'like'
  if (/^(?:离开了|退出了)(?:房间|一起听)?(?:[\s，,。！!]|$)/u.test(action)) return 'leave'
  return 'notice'
}
function titleSpans(text: string, title: string, after: number): Span[] {
  const spans: Span[] = []
  let from = after
  while (from < text.length) {
    const start = text.indexOf(title, from)
    if (start < 0) break
    const end = start + title.length,
      before = text.slice(0, start),
      rest = text.slice(end)
    const begins =
      !before.trim() ||
      /[《「“"【:：·|/]\s*$/u.test(before) ||
      /(?:歌曲|专辑|歌单)\s*$/u.test(before)
    const ends = !rest.trim() || /^\s*(?:[-–—]\s|[》」”"】。！？；，,!?;·|/])/u.test(rest)
    if (begins && ends) spans.push({ start, end, kind: 'song' })
    from = end
  }
  return spans
}
function templateTitle(action: string, offset: number): Span | null {
  const prefix = /^(?:来了[，,]\s*带来歌曲|带来歌曲|推荐了歌曲[：:]?)\s*/u.exec(action)
  if (!prefix) return null
  let value = action.slice(prefix[0].length),
    start = offset + prefix[0].length
  const closing: Record<string, string> = { '《': '》', '「': '」', '“': '”', '"': '"' }
  const endQuote = closing[value[0]]
  if (endQuote) {
    if (!value.endsWith(endQuote)) return null
    value = value.slice(1, -1)
    start++
  }
  const separators = [...value.matchAll(/\s+[-–—]\s+/gu)]
  // Without resource metadata, multiple separators are ambiguous; preserve plain text.
  if (separators.length > 1 || (!endQuote && separators.length !== 1)) return null
  const title = value.slice(0, separators[0]?.index ?? value.length).trim()
  if (
    !title ||
    (separators.length && !value.slice(separators[0].index! + separators[0][0].length).trim())
  )
    return null
  start += value.indexOf(title)
  return { start, end: start + title.length, kind: 'song' }
}

export function roomActivityPresentation(
  message: Pick<ChatMessage, 'nickname' | 'text' | 'attachments'>,
): RoomActivityPresentation {
  const text = roomActivityText(message),
    body = message.text.trim(),
    nickname = message.nickname.trim(),
    hasActor = actorPrefix(body, nickname),
    bodyOffset = nickname && !hasActor ? nickname.length + 3 : 0,
    rawAction = body.slice(hasActor ? nickname.length : 0),
    action = rawAction.replace(/^[\s·:：，,]+/u, ''),
    actionOffset = bodyOffset + (hasActor ? nickname.length : 0) + rawAction.length - action.length,
    type = eventType(action)
  const spans: Span[] = nickname ? [{ start: 0, end: nickname.length, kind: 'actor' }] : []
  const titles = [
    ...new Set(
      (message.attachments || [])
        .filter(
          (item) =>
            item.kind === 'resource' && (!item.resourceType || item.resourceType === 'song'),
        )
        .map((item) => item.title.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length)
  for (const title of titles) {
    for (const span of titleSpans(text, title, nickname.length)) {
      if (!spans.some((other) => other.start < span.end && span.start < other.end)) spans.push(span)
    }
  }
  if (!titles.length) {
    const span = templateTitle(action, actionOffset)
    if (span) spans.push(span)
  }
  spans.sort((a, b) => a.start - b.start)
  const parts: RoomActivityPart[] = []
  let position = 0
  for (const span of spans) {
    if (position < span.start) parts.push({ kind: 'text', text: text.slice(position, span.start) })
    parts.push({ kind: span.kind, text: text.slice(span.start, span.end) })
    position = span.end
  }
  if (position < text.length) parts.push({ kind: 'text', text: text.slice(position) })
  return { text, type, ...events[type], parts }
}
