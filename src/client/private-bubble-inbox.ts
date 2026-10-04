import type { Conversation } from '@party/shared/types'
import type { PrivateNotice } from '../shared/private-notices'
import { t } from './i18n'
import type { PrivateReadBoundary } from './private-view-activity'

export interface BubbleConversation extends Conversation {
  receivedAt: number
}

export function privateNoticePreview(notice: PrivateNotice) {
  if (notice.kind !== 'message') return ''
  const text = notice.text.trim()
  if (text && !/升级\s*App\s*到最新版本/.test(text)) return text
  return t('收到一条新私信')
}

/** A bounded live inbox. Only successful view read receipts clear its unread counts. */
export class PrivateBubbleInbox {
  readonly conversations = new Map<string, BubbleConversation>()
  private seen = new Set<string>()
  private unread = new WeakMap<
    BubbleConversation,
    Map<string, { messageId: string; timestamp: number }>
  >()
  private startedAt: number
  constructor(private now = () => Date.now()) {
    this.startedAt = now()
  }

  receive(notice: PrivateNotice, selfUid: string, pinnedPeers: Iterable<string> = []) {
    if (
      notice.kind !== 'message' ||
      notice.self ||
      notice.senderUid === selfUid ||
      notice.peerUid === selfUid ||
      !/^[1-9]\d*$/.test(notice.peerUid) ||
      this.seen.has(notice.id)
    )
      return null
    this.seen.add(notice.id)
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!)
    // A retained main-process queue may outlive a renderer. Do not replay old toasts on activation.
    if (notice.timestamp < this.startedAt - 10_000) return null
    const previous = this.conversations.get(notice.peerUid)
    const pending = (previous && this.unread.get(previous)) || new Map()
    pending.set(notice.id, { messageId: notice.messageId, timestamp: notice.timestamp })
    if (pending.size > 999) pending.delete(pending.keys().next().value!)
    const peer: BubbleConversation = {
      uid: notice.peerUid,
      nickname: notice.senderName || previous?.nickname || t('网易云用户'),
      avatar: notice.senderAvatar || previous?.avatar || '',
      preview: privateNoticePreview(notice),
      time: notice.timestamp,
      receivedAt: this.now(),
      unread: pending.size,
    }
    this.unread.set(peer, pending)
    this.conversations.delete(peer.uid)
    this.conversations.set(peer.uid, peer)
    if (this.conversations.size > 64) {
      // At most five retained editors exist. Keep their rail entries reachable,
      // including minimized editors with a draft, without unbounding the inbox.
      const pinned = new Set<string>()
      for (const uid of pinnedPeers) {
        pinned.add(uid)
        if (pinned.size === 5) break
      }
      for (const uid of this.conversations.keys()) {
        if (!pinned.has(uid)) this.conversations.delete(uid)
        if (this.conversations.size <= 64) break
      }
    }
    return peer
  }

  read(uid: string, boundary: PrivateReadBoundary) {
    const peer = this.conversations.get(uid)
    if (!peer) return true
    const pending = this.unread.get(peer)
    const ids = new Set(boundary.messageIds)
    if (pending)
      for (const [id, message] of pending)
        if (
          message.timestamp < boundary.timestamp ||
          (message.timestamp === boundary.timestamp && ids.has(message.messageId))
        )
          pending.delete(id)
    peer.unread = pending?.size ?? 0
    return peer.unread === 0
  }

  reset() {
    this.conversations.clear()
    this.seen.clear()
    this.unread = new WeakMap()
    this.startedAt = this.now()
  }
}
