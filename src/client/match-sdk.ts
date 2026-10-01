import type { AccountConnection } from './host'
import type { MatchNotice } from '../shared/match-notice'

// src/client/match-sdk.ts
// Only validated matching notices cross RPC. Authentication and the socket stay in main.
export interface MatchNotification {
  timestamp: number
  notice: MatchNotice
}
export async function createMatchSdk(connection: Pick<AccountConnection, 'matchTransport'>) {
  const id = crypto.randomUUID()
  let closed = false,
    timer: ReturnType<typeof setTimeout> | undefined
  let receive = (_event: MatchNotification) => {},
    disconnected = () => {}
  const close = () => {
    if (closed) return
    closed = true
    clearTimeout(timer)
    void connection.matchTransport('matchClose', id).catch(() => {})
  }
  const poll = async () => {
    try {
      const events = (await connection.matchTransport('matchPoll', id)) as MatchNotification[]
      if (closed) return
      for (const event of events) {
        if (!closed) receive(event)
      }
      if (!closed) timer = setTimeout(() => void poll(), 300)
    } catch {
      if (!closed) {
        close()
        disconnected()
      }
    }
  }
  return {
    async login() {
      if (closed) throw new Error('匹配已取消')
      await connection.matchTransport('matchOpen', id)
      if (closed) {
        await connection.matchTransport('matchClose', id).catch(() => {})
        return
      }
      void poll()
    },
    onNotification: (callback: typeof receive) => {
      receive = callback
    },
    onDisconnect: (callback: typeof disconnected) => {
      disconnected = callback
    },
    close,
  }
}
