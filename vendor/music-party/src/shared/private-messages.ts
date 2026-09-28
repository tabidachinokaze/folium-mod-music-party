import type { Conversation, MultiInvitation, PrivateMessage, PrivatePage } from './types'
import { richMessageContent, messageObject } from './message-content'
import { neteaseAssetUrl } from './media'
import { invitation, parseInvitation } from './protocol'
export const PRIVATE_TEXT_LIMIT = 500
export const SEND_METHODS = new Set([
  'multiChatSend',
  'privateSend',
  'privateInvite',
  'privateSticker',
])
export const PRIVATE_METHODS = new Set([
  'privateConversations',
  'privateHistory',
  'privateRead',
  'privateSend',
  'privateInvite',
  'privateSticker',
  'stickerGroups',
  'stickerPage',
  'follows',
])
function uid(value: unknown): string | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  const text = String(value ?? '')
  return /^[1-9]\d{0,23}$/.test(text) ? text : null
}
function payload(value: unknown): any {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return typeof parsed === 'string'
        ? { msg: parsed, type: 1 }
        : parsed && typeof parsed === 'object'
          ? parsed
          : {}
    } catch {
      return { msg: value, type: 1 }
    }
  }
  return value && typeof value === 'object' ? value : {}
}
export function findInvitations(value: unknown): MultiInvitation[] {
  const found = new Map<string, MultiInvitation>()
  const seen = new Set<string>()
  let budget = 250
  const add = (link: string) => {
    try {
      const invite = parseInvitation(link)
      found.set(`${invite.roomId}:${invite.inviterUid}`, invite)
    } catch {}
  }
  const visitUrl = (candidate: string, depth: number) => {
    if (--budget < 0 || depth > 6 || candidate.length > 20000 || seen.has(candidate)) return
    seen.add(candidate)
    const clean = candidate.replace(/\\&/g, '&').replace(/&amp;|&#0*38;|&#x0*26;/gi, '&')
    // Native cards can nest percent-encoded deep links inside url1/url2. Decode only encoded URLs.
    if (/^(?:https?|orpheus)%3a/i.test(clean)) {
      try {
        visitUrl(decodeURIComponent(clean), depth + 1)
      } catch {}
      return
    }
    let url: URL
    try {
      url = new URL(clean)
    } catch {
      return
    }
    if (url.username || url.password || url.port) return
    const native = url.protocol === 'orpheus:'
    const official =
      ['https:', 'http:'].includes(url.protocol) &&
      ['st.music.163.com', 'music.163.com'].includes(url.hostname)
    if (!native && !official) return
    if (official) {
      // Only construct a canonical HTTPS invitation after the existing strict route/parameter checks.
      const canonical = new URL(url)
      canonical.protocol = 'https:'
      add(canonical.toString())
    }
    if (native && url.hostname === 'nm' && url.pathname === '/multiListenTogether/joinRoom') {
      if (
        url.searchParams.getAll('roomId').length === 1 &&
        url.searchParams.getAll('inviterId').length === 1
      ) {
        add(
          invitation({
            roomId: url.searchParams.get('roomId') || '',
            inviterUid: url.searchParams.get('inviterId') || '',
            role: 'guest',
          }),
        )
      }
    }
    // CommonMessage.nativeUrl uses url1 (native target), url2 (web fallback); webview uses url.
    // Never open or fetch the outer URI. Every extracted target must itself pass the allowlist.
    for (const key of ['url1', 'url2', 'url']) {
      for (const nested of url.searchParams.getAll(key).slice(0, 3)) visitUrl(nested, depth + 1)
    }
  }
  const visit = (item: unknown, depth: number) => {
    if (--budget < 0 || depth > 8) return
    if (typeof item === 'string') {
      const text = item.slice(0, 20000)
      // Parse JSON before scanning it so JSON-escaped slashes and nested bodies are interpreted correctly.
      if (/^[\[{]/.test(text.trim())) {
        try {
          visit(JSON.parse(text), depth + 1)
          return
        } catch {}
      }
      if (/^(?:https?|orpheus)%3a/i.test(text.trim())) {
        visitUrl(text.trim(), 0)
        return
      }
      const candidates = text.match(/(?:https?:\/\/|orpheus:\/\/)[^\s<>"“”\]\)]+/g) || []
      for (const candidate of candidates.slice(0, 15)) visitUrl(candidate, 0)
    } else if (Array.isArray(item)) for (const child of item.slice(0, 30)) visit(child, depth + 1)
    else if (item && typeof item === 'object')
      for (const child of Object.values(item).slice(0, 30)) visit(child, depth + 1)
  }
  visit(value, 0)
  return [...found.values()].slice(0, 5)
}

export function messageContent(
  value: unknown,
  envelope?: unknown,
): Pick<PrivateMessage, 'text' | 'invitations' | 'attachments' | 'richText'> {
  const data = { ...messageObject(envelope), ...payload(value) }
  const invitations = findInvitations(envelope ? [data, envelope] : data)
  const content = richMessageContent(data)
  if (typeof data.msg === 'string' && data.msg.startsWith('[文件] ')) {
    const [name, url] = data.msg.slice(5).split('\n')
    const safe = neteaseAssetUrl(url)
    if (name && safe) content.attachments = [{ kind: 'file', title: name, actionUrl: safe }]
  }
  if (invitations.length && content.attachments)
    content.attachments = content.attachments.filter((item) => item.resourceType !== 'general')
  const body = messageObject(data.body ?? data.msgBody)
  const label =
    typeof data.msg === 'string'
      ? data.msg
      : typeof data.message === 'string'
        ? data.message
        : typeof data.text === 'string'
          ? data.text
          : typeof data.title === 'string'
            ? data.title
            : typeof data.text?.textBody === 'string'
              ? data.text.textBody
              : typeof body.textBody === 'string'
                ? body.textBody
                : typeof body.text === 'string'
                  ? body.text
                  : ''
  let text = label
  if (!text) {
    if (invitations.length) text = '邀请你加入官方多人一起听'
    else if (data.song) text = `[分享歌曲] ${data.song.name || ''}`
    else if (data.playlist) text = `[分享歌单] ${data.playlist.name || ''}`
    else if (data.album) text = `[分享专辑] ${data.album.name || ''}`
    else if (content.attachments?.length) text = content.attachments[0].title
    else text = '[暂不支持的私信类型]'
  }
  return { text: text.slice(0, 10000), invitations, ...content }
}
export function parseConversations(
  body: any,
  selfUid: string,
): { conversations: Conversation[]; more: boolean; count: number } {
  if (!Array.isArray(body?.msgs)) throw new Error('私信会话响应格式异常，请重试')
  const conversations: Conversation[] = []
  for (const raw of body.msgs) {
    if (!raw || typeof raw !== 'object') continue
    const profile = String(raw.fromUser?.userId) === selfUid ? raw.toUser : raw.fromUser
    const peer = uid(profile?.userId)
    if (!peer || peer === selfUid) continue
    conversations.push({
      uid: peer,
      nickname: profile.nickname || `用户 ${peer}`,
      avatar: profile.avatarUrl || '',
      preview: messageContent(raw.lastMsg).text,
      time: Number(raw.lastMsgTime) || 0,
      unread: Math.max(0, Number(raw.newMsgCount) || 0),
    })
  }
  return {
    conversations,
    more: typeof body.more === 'boolean' ? body.more : body.msgs.length === 30,
    count: body.msgs.length,
  }
}
export function mergeConversations(
  previous: Conversation[],
  incoming: Conversation[],
): Conversation[] {
  const values = new Map(previous.map((item) => [item.uid, item]))
  for (const item of incoming) {
    const old = values.get(item.uid)
    if (!old || item.time >= old.time) values.set(item.uid, item)
  }
  return [...values.values()].sort((a, b) => b.time - a.time)
}
export function parsePrivatePage(body: any, selfUid: string, peerUid: string): PrivatePage {
  if (!Array.isArray(body?.msgs)) throw new Error('私信内容响应格式异常，请重试')
  const messages: PrivateMessage[] = []
  const times: number[] = []
  for (const raw of body.msgs) {
    if (!raw || typeof raw !== 'object') continue
    const time = Number(raw.time)
    if (!Number.isSafeInteger(time) || time <= 0) continue
    times.push(time)
    const from = uid(raw.fromUser?.userId),
      to = uid(raw.toUser?.userId)
    if (
      !from ||
      !to ||
      !((from === selfUid && to === peerUid) || (from === peerUid && to === selfUid))
    )
      continue
    const content = messageContent(raw.msg, {
      body: raw.body,
      msgType: raw.msgType,
      msgBody: raw.msgBody,
      nativeUrl: raw.nativeUrl,
    })
    const recordId = uid(raw.id)
    messages.push({
      id: recordId ? `server:${recordId}` : `${from}:${to}:${time}:${content.text}`,
      senderId: from,
      recipientId: to,
      time,
      ...content,
    })
  }
  return {
    messages: mergePrivate([], messages),
    more: typeof body.more === 'boolean' ? body.more : body.msgs.length === 30,
    before: times.length ? Math.min(...times) : null,
  }
}
export function mergePrivate(
  previous: PrivateMessage[],
  incoming: PrivateMessage[],
): PrivateMessage[] {
  const sameMedia = (a: string | undefined, b: string | undefined) => {
    if (!a || !b) return false
    if (a === b) return true
    const left = neteaseAssetUrl(a),
      right = neteaseAssetUrl(b)
    return !!left && !!right && new URL(left).pathname === new URL(right).pathname
  }
  const values = new Map(previous.map((m) => [m.id, m]))
  incoming.forEach((m) => values.set(m.id, m))
  const server = [...values.values()].filter((m) => !m.delivery)
  const used = new Set<string>()
  for (const local of [...values.values()].filter((m) => m.delivery)) {
    const echo = server.find(
      (m) =>
        !used.has(m.id) &&
        m.senderId === local.senderId &&
        m.recipientId === local.recipientId &&
        (m.text === local.text ||
          !!local.attachments?.some((a) =>
            m.attachments?.some(
              (b) =>
                a.kind === b.kind &&
                ((a.resourceId && a.resourceId === b.resourceId) ||
                  sameMedia(a.url, b.url) ||
                  (a.actionUrl && a.actionUrl === b.actionUrl)),
            ),
          )) &&
        m.time > (local.echoAfter ?? -1) &&
        Math.abs(m.time - local.time) <= 60000,
    )
    if (echo) {
      used.add(echo.id)
      values.delete(local.id)
    }
  }
  return [...values.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
}
export function inviteText(roomId: string, inviterUid: string): string {
  return `邀请你来网易云音乐一起听：${invitation({ roomId, inviterUid, role: 'host' })}`
}
export function privateTrace(body: any) {
  return {
    code: body?.code,
    messageCount: Array.isArray(body?.msgs) ? body.msgs.length : undefined,
    contactCount: Array.isArray(body?.follow) ? body.follow.length : undefined,
    more: body?.more,
  }
}
