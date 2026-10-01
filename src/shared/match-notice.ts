// src/shared/match-notice.ts
export type MatchNotice = { kind: 'ready'; roomId: string } | { kind: 'failed'; reason: string }
const record = (value: unknown): Record<string, any> | null => {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null
}
// Only the official multiplayer matching business envelope may authorize an ACK.
export function parseMatchNotice(content: unknown): MatchNotice | null {
  const envelope = record(content)
  if (
    !envelope ||
    ![132, 133].includes(envelope.msgType) ||
    envelope.bizType !== 'music_listenTogether_multi_match_song'
  )
    return null
  const event = record(envelope.serverExt),
    data = record(event?.data)
  if (!event || !data) return null
  if (
    event.subType === 'STRANGER_MULTI_MATCH_WAIT_ACK' &&
    typeof data.roomId === 'string' &&
    /^[\w-]{1,128}$/.test(data.roomId)
  )
    return { kind: 'ready', roomId: data.roomId }
  if (event.subType === 'STRANGER_MULTI_MATCH_FAILED')
    return {
      kind: 'failed',
      reason: typeof data.failedType === 'string' ? data.failedType.slice(0, 100) : 'MATCH_FAILED',
    }
  return null
}
