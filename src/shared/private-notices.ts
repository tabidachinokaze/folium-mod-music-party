// src/shared/private-notices.ts
// Sanitized, in-memory events. Cookies, IM tokens and raw server envelopes never cross RPC.
export interface PrivatePeer {
  uid: string
  nickname: string
  avatar: string
  /** Only the official private-message setting's explicit boolean is a known state. */
  online: boolean | null
}

export interface PrivateMessageNotice {
  kind: 'message' | 'change'
  id: string
  peerUid: string
  senderUid: string
  senderName?: string
  senderAvatar?: string
  messageId: string
  timestamp: number
  messageType: number
  text: string
  self: boolean
}

export interface PrivateSyncNotice {
  kind: 'sync'
  id: string
  timestamp: number
}

export type PrivateNotice = PrivateMessageNotice | PrivateSyncNotice

export interface PrivateNotificationEvent {
  sequence: number
  notice: PrivateNotice
}

export interface PrivateNotificationBatch {
  /** Opaque account-generation identifier, never a cookie or account credential. */
  session: string
  cursor: number
  connected: boolean
  /** The reader missed retained events or supplied a previous account's session. */
  reset: boolean
  events: PrivateNotificationEvent[]
}
