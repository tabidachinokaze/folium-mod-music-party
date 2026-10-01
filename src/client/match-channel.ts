import { createMatchSdk } from './match-sdk'

import type { MatchNotice } from '../shared/match-notice'
import type { AccountConnection } from './host'

// src/client/match-channel.ts
export { parseMatchNotice, type MatchNotice } from '../shared/match-notice'
export interface MatchChannel {
  connect(receive: (event: MatchNotice) => void, disconnect: () => void): Promise<void>
  arm(): void
  confirmStart(startTime?: number): void
  close(): void
}
export function createMatchChannel(
  connection: Pick<AccountConnection, 'matchTransport'>,
): MatchChannel {
  let disposed = false,
    armed = false,
    confirmed = false,
    minimumTime = 0
  let destroy = () => {},
    receiveNotice = (_event: MatchNotice) => {}
  const pending: Array<{ timestamp: number; notice: MatchNotice }> = []
  const deliver = () => {
    if (!confirmed || disposed) return
    for (const event of pending.splice(0)) {
      if (event.timestamp >= minimumTime && !disposed) receiveNotice(event.notice)
    }
  }
  return {
    async connect(receive, disconnect) {
      receiveNotice = receive
      const sdk = await createMatchSdk(connection)
      if (disposed) {
        sdk.close()
        return
      }
      destroy = sdk.close
      sdk.onNotification((notification) => {
        if (disposed || !armed || !Number.isFinite(notification.timestamp)) return
        const notice = notification.notice
        if (!notice) return
        if (pending.length >= 10) pending.shift()
        pending.push({ timestamp: notification.timestamp, notice })
        deliver()
      })
      sdk.onDisconnect(() => {
        if (!disposed && armed) disconnect()
      })
      await sdk.login()
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
      destroy()
    },
  }
}
