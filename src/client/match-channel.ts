import { createMatchSdk } from './match-sdk'

// src/client/match-channel.ts
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
export interface MatchChannel {
  connect(
    credentials: { accId: string; token: string },
    receive: (event: MatchNotice) => void,
    disconnect: () => void,
  ): Promise<void>
  arm(): void
  confirmStart(startTime?: number): void
  close(): void
}
export function createMatchChannel(): MatchChannel {
  let disposed = false,
    armed = false,
    confirmed = false,
    minimumTime = 0
  let destroy = () => {},
    credentialsAccount = '',
    receiveNotice = (_event: MatchNotice) => {}
  const pending: Array<{ timestamp: number; notice: MatchNotice }> = []
  const deliver = () => {
    if (!confirmed || disposed) return
    for (const event of pending.splice(0)) {
      if (event.timestamp >= minimumTime && !disposed) receiveNotice(event.notice)
    }
  }
  return {
    async connect(credentials, receive, disconnect) {
      credentialsAccount = credentials.accId
      receiveNotice = receive
      const sdk = await createMatchSdk()
      if (disposed) {
        sdk.close()
        return
      }
      destroy = sdk.close
      sdk.onNotification((notification) => {
        if (
          disposed ||
          !armed ||
          notification.receiverId !== credentialsAccount ||
          !Number.isFinite(notification.timestamp)
        )
          return
        const notice = parseMatchNotice(notification.content)
        if (!notice) return
        if (pending.length >= 10) pending.shift()
        pending.push({ timestamp: notification.timestamp, notice })
        deliver()
      })
      sdk.onDisconnect(() => {
        if (!disposed && armed) disconnect()
      })
      await sdk.login(credentials.accId, credentials.token)
    },
    arm() {
      armed = true
    },
    confirmStart(startTime) {
      // Compare server timestamps with the server's match start, never the desktop's clock.
      minimumTime = Number.isFinite(startTime) && startTime! > 0 ? startTime! : 0
      confirmed = true
      deliver()
    },
    close() {
      disposed = true
      armed = false
      pending.length = 0
      credentialsAccount = ''
      destroy()
    },
  }
}
