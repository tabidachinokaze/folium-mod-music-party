import { parseRoomQueue } from '@party/shared/playback-queue'
import { parseChatPage, mergeChat } from '@party/shared/chat'
import type { ChatMessage, Method, RoomQueueEntry } from '@party/shared/types'

// src/client/room-data.ts
export type Call = (method: Method, args?: Record<string, unknown>) => Promise<any>
export async function loadQueue(
  call: Call,
  roomId: string,
  current: () => boolean,
): Promise<RoomQueueEntry[]> {
  const rows = new Map<string, RoomQueueEntry>()
  const seen = new Set<string>()
  let cursor = ''
  do {
    const page = parseRoomQueue(await call('multiQueue', { roomId, ...(cursor ? { cursor } : {}) }))
    if (!current()) return []
    page.entries.forEach((row) => rows.set(row.songBizId, row))
    if (!page.more) return [...rows.values()]
    if (!page.cursor || seen.has(page.cursor) || seen.size >= 1000)
      throw new Error('待播列表分页异常，请刷新')
    seen.add(page.cursor)
    cursor = page.cursor
  } while (current())
  return []
}
export async function loadChat(
  call: Call,
  roomId: string,
  uid: string,
  previous: ChatMessage[],
  cursor?: string,
) {
  const page = parseChatPage(
    await call('multiChatHistory', { roomId, ...(cursor ? { cursor } : {}) }),
    roomId,
    uid,
  )
  return { ...page, messages: mergeChat(previous, page.messages).slice(-1000) }
}
