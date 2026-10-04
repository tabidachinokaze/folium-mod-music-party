import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { neteaseAssetUrl } from '@party/shared/media'
import type { PrivateMessageNotice } from '../shared/private-notices'

// src/main/private-notice.ts
// Official Android 8.8.40: MainActivity.B8 -> ChatIMManager.onMessageReceived.
// Only private realtime notices are decoded; retrieve_msg_notice is log salvage.
export const PRIVATE_REALTIME_BIZ = 'music_communication_realtime_msg_notice'
const MAX_ENVELOPE = 768 * 1024
const MAX_COMPRESSED = 256 * 1024
const MAX_DECOMPRESSED = 512 * 1024

function parse(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value.length > MAX_ENVELOPE) return null
  return JSON.parse(value, (_key, item, context?: { source?: string }) => {
    // Node 24+ provides the original number token; keep long message IDs exact.
    if (
      typeof item === 'number' &&
      !Number.isSafeInteger(item) &&
      context?.source &&
      /^\d+$/.test(context.source)
    )
      return context.source
    return item
  })
}
function record(value: unknown): Record<string, unknown> | null {
  const item = parse(value)
  return item && typeof item === 'object' && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : null
}
function uid(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return ''
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  return /^[1-9]\d{0,23}$/.test(text) ? text : ''
}
function messageId(value: unknown): string {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0 ? String(value) : ''
  return typeof value === 'string' && /^[\w:.-]{1,160}$/.test(value) ? value : ''
}
function senderProfile(body: Record<string, unknown>): Record<string, unknown> | null {
  try {
    const sender = record(body.sender)
    // Current RawMessage uses sender.user; retain the older flat sender fallback.
    return record(sender?.user) || sender
  } catch {
    // Optional display metadata must not discard an otherwise valid private notice.
    return null
  }
}
function summary(body: Record<string, unknown>): string {
  const text = record(body.text)
  const value = typeof text?.textBody === 'string' ? text.textBody : body.briefText
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 500)
    : ''
}

/** Untrusted compressed input is bounded and failures do not interrupt other IM businesses. */
export function parsePrivateNotice(
  content: unknown,
  timestamp: number,
  selfUid: string,
): PrivateMessageNotice | null {
  try {
    if (!uid(selfUid)) return null
    const envelope = record(content)
    if (
      !envelope ||
      ![132, 133].includes(Number(envelope.msgType)) ||
      envelope.bizType !== PRIVATE_REALTIME_BIZ
    )
      return null
    const ext = record(envelope.serverExt)
    if (typeof ext?.data !== 'string' || ext.data.length > MAX_ENVELOPE) return null
    const encoded = ext.data.replace(/\s/g, '')
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) return null
    const compressed = Buffer.from(encoded, 'base64')
    if (!compressed.length || compressed.length > MAX_COMPRESSED) return null
    const raw = record(
      gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED }).toString('utf8'),
    )
    if (!raw || raw.scene !== 1) return null
    const peerUid = uid(raw.channelId)
    if (!peerUid || peerUid === selfUid) return null
    const targets = raw.targetUserList === '' ? null : parse(raw.targetUserList)
    if (targets != null && targets !== '') {
      if (
        !Array.isArray(targets) ||
        (targets.length && !targets.some((target) => uid(target) === selfUid))
      )
        return null
    }
    const body = record(raw.msgBody)
    if (!body) return null
    const profile = senderProfile(body)
    const senderUid = uid(raw.senderUserId) || uid(profile?.userId)
    const id = messageId(body.msgId)
    const messageType = Number(body.msgType)
    if (!id || !Number.isSafeInteger(messageType) || messageType < 0) return null
    const kind = messageType === 99 || raw.clientUiFlag === false ? 'change' : 'message'
    if (!senderUid && kind === 'message') return null
    const time = Number(body.msgTime)
    const receivedAt = Number.isSafeInteger(time) && time > 0 ? time : timestamp
    if (!Number.isSafeInteger(receivedAt) || receivedAt <= 0) return null
    // Command updates can reuse a message ID. Hash only their body, never expose the raw envelope.
    const suffix =
      kind === 'change'
        ? `:${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`
        : ''
    const sameSender = !!senderUid && uid(profile?.userId) === senderUid
    const senderName =
      sameSender && typeof profile?.nickname === 'string'
        ? profile.nickname
            .replace(/[\u0000-\u001f\u007f]/g, '')
            .trim()
            .slice(0, 160)
        : ''
    const senderAvatar = sameSender ? neteaseAssetUrl(profile?.avatarUrl) : undefined
    return {
      kind,
      id: `${peerUid}:${id}:${messageType}${suffix}`,
      peerUid,
      senderUid,
      ...(senderName ? { senderName } : {}),
      ...(senderAvatar ? { senderAvatar } : {}),
      messageId: id,
      timestamp: receivedAt,
      messageType,
      text: summary(body),
      self: senderUid === selfUid,
    }
  } catch {
    return null
  }
}
