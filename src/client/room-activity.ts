import type { ChatMessage } from '@party/shared/types'

// src/client/room-activity.ts
export function hasActivityActor(text: string, nickname: string) {
  if (!text.startsWith(nickname)) return false
  const rest = text.slice(nickname.length)
  return (
    !rest ||
    /^(?:[\s·:：，,]|来了|推荐了|离开了|加入了|退出了|为(?:歌曲|这首歌)|点赞了|(?:UP|up)了|置顶了)/u.test(
      rest,
    )
  )
}
function hasTitle(text: string, title: string) {
  let from = 0
  while (from < text.length) {
    const index = text.indexOf(title, from)
    if (index < 0) return false
    const before = text.slice(0, index),
      after = text.slice(index + title.length)
    // Match a complete resource name, not ordinary words or “Love” within “Love Yourself”.
    const start =
      !before.trim() ||
      /[《「“"【:：·|/]\s*$/u.test(before) ||
      /(?:歌曲|专辑|歌单)\s*$/u.test(before)
    const end = !after.trim() || /^\s*(?:[-–—]\s|[》」”"】。！？；，,!?;·|/])/u.test(after)
    if (start && end) return true
    from = index + title.length
  }
  return false
}
export function roomActivityText(message: Pick<ChatMessage, 'nickname' | 'text' | 'attachments'>) {
  const text = message.text.trim(),
    nickname = message.nickname.trim()
  const parts = [text].filter(Boolean)
  if (nickname && !hasActivityActor(text, nickname)) parts.unshift(nickname)
  const titles = new Set<string>()
  for (const attachment of message.attachments || []) {
    const title = attachment.title.trim()
    if (title && !titles.has(title) && !hasTitle(text, title)) titles.add(title)
  }
  if (titles.size) parts.push([...titles].join(' / '))
  return parts.join(' · ')
}
