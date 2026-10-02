import type { ChatEmoji, MessageAttachment, MessageTextPart } from './types'
import { neteaseAssetUrl } from './media'
import { messageActionTarget, musicMessageWebLink } from './message-action'

export { messageActionTarget, safeMessageActionUrl } from './message-action'

export function messageObject(value: unknown): any {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      return messageObject(JSON.parse(value))
    } catch {}
  }
  return {}
}
const text = (value: unknown, max = 1000) => (typeof value === 'string' ? value.slice(0, max) : '')
export function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return
  try {
    const url = new URL(value)
    if (url.protocol === 'http:' && /(^|\.)music\.126\.net$/.test(url.hostname))
      url.protocol = 'https:'
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !url.hostname.includes('.') ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/.test(
        url.hostname,
      ) ||
      /\.(local|internal)$/.test(url.hostname)
    )
      return
    return url.href
  } catch {
    return
  }
}
export function musicMessageLink(value: unknown, depth = 0): string | undefined {
  return musicMessageWebLink(value, depth)
}
const resourceLink = (type: string, id: unknown) => {
  const value = String(id ?? '')
  if (!/^[\w-]{1,100}$/.test(value)) return
  const route: Record<string, string> = {
    song: 'song',
    playlist: 'playlist',
    album: 'album',
    artist: 'artist',
    program: 'program',
    radio: 'djradio',
    mv: 'mv',
    video: 'video',
    user: 'user/home',
    topic: 'topic',
    event: 'event',
    mlog: 'mlog',
  }
  return route[type]
    ? `https://music.163.com/${route[type]}?id=${encodeURIComponent(value)}`
    : undefined
}
export function parseEmoji(value: unknown): ChatEmoji | undefined {
  const item = messageObject(value)
  const url = mediaUrl(item.emojiImgUrl)
  const id = String(item.emojiId ?? 0),
    group = String(item.emojiGroupId ?? 0)
  if (!url || !/^\d{1,24}$/.test(id) || !/^-?\d{1,24}$/.test(group)) return
  if (
    [item.emojiId, item.emojiGroupId].some((v) => typeof v === 'number' && !Number.isSafeInteger(v))
  )
    return
  return {
    emojiId: id,
    emojiGroupId: group,
    emojiName: text(item.emojiName || item.name, 80) || '表情',
    emojiImgUrl: url,
    width: Math.min(4096, Math.max(1, Number(item.width) || 160)),
    height: Math.min(4096, Math.max(1, Number(item.height) || 160)),
    format: text(item.format, 16),
  }
}
export function richMessageContent(value: unknown): {
  attachments?: MessageAttachment[]
  richText?: MessageTextPart[]
} {
  const root = messageObject(value)
  const body = messageObject(root.body ?? root.msgBody)
  const data = { ...root, ...body }
  const typed: Record<number, string> = {
    2: 'generalMsg',
    30: 'song',
    31: 'song',
    32: 'playlist',
    33: 'program',
    34: 'artist',
    35: 'album',
    36: 'mv',
    37: 'topic',
    38: 'user',
    39: 'event',
    40: 'radio',
    41: 'comment',
    42: 'concert',
    43: 'concert',
    44: 'video',
    45: 'live',
    46: 'promotion',
    47: 'generalMsg',
    48: 'mlog',
  }
  const isMusicResource = typed[root.msgType] === 'song' || typed[root.msgType] === 'album'
  const attachments: MessageAttachment[] = []
  const addMedia = (kind: 'image' | 'audio' | 'video', raw: any, title: string) => {
    if (!raw) return
    const item = messageObject(raw)
    const url = mediaUrl(
      typeof raw === 'string'
        ? raw
        : item.url ||
            item.originUrl ||
            item.originalUrl ||
            item.picUrl ||
            item.imgUrl ||
            item.emojiImgUrl ||
            item.voiceUrl ||
            item.playUrlInfo?.url ||
            item.videoUrl,
    )
    attachments.push({
      kind,
      title: text(item.name || item.title) || title,
      url,
      cover: mediaUrl(
        item.coverUrl || item.cover || item.coverImage?.url || item.coverImage?.picUrl,
      ),
      resourceId:
        typeof (item.md5 || item.voiceKey || item.videoKey) === 'string'
          ? item.md5 || item.voiceKey || item.videoKey
          : undefined,
    })
  }
  const emoji = parseEmoji(data.emoji)
  if (emoji) addMedia('image', emoji, emoji.emojiName)
  const images = data.pics || data.pictures || data.images
  if (Array.isArray(images)) images.slice(0, 9).forEach((pic) => addMedia('image', pic, '图片'))
  else
    addMedia(
      'image',
      data.picInfo || data.picture || data.image || (!isMusicResource ? data.picUrl : null),
      '图片',
    )
  addMedia('audio', data.voice || data.audio || (data.voiceUrl ? data : null), '语音消息')
  const video = messageObject(data.video)
  if (
    video.url ||
    video.videoUrl ||
    video.playUrlInfo?.url ||
    data.videoUrl ||
    data.playUrlInfo?.url
  )
    addMedia('video', data.video || data, '视频消息')
  // New message-center envelopes use msgType; legacy private-history type values are different.
  if (root.msgType === 1 && !attachments.length) addMedia('image', body, '图片')
  if (root.msgType === 4 && !attachments.length) addMedia('audio', body, '语音消息')
  if (root.msgType === 5 && !attachments.length) addMedia('video', body, '视频消息')
  const resources: [string, string, string][] = [
    ['song', 'song', '歌曲'],
    ['playlist', 'playlist', '歌单'],
    ['album', 'album', '专辑'],
    ['artist', 'artist', '歌手'],
    ['program', 'program', '播客节目'],
    ['djRadio', 'radio', '播客'],
    ['radio', 'radio', '播客'],
    ['mv', 'mv', 'MV'],
    ['video', 'video', '视频'],
    ['user', 'user', '用户'],
    ['profile', 'user', '用户'],
    ['topic', 'topic', '话题'],
    ['subject', 'topic', '专题'],
    ['event', 'event', '动态'],
    ['activity', 'event', '活动'],
    ['mlog', 'mlog', 'Mlog'],
    ['concert', 'concert', '演出'],
    ['live', 'live', '直播'],
    ['comment', 'comment', '评论'],
    ['generalMsg', 'general', '消息卡片'],
    ['promotion', 'general', '活动卡片'],
  ]
  for (const [key, type, label] of resources) {
    let raw = data[key]
    // Music cards own their related album/artist metadata and cover. Other message
    // kinds keep the existing mixed-attachment behavior of the generic renderer.
    if (isMusicResource && typed[root.msgType] !== key) continue
    if (!raw && typed[root.msgType] === key) raw = body
    if (!raw || (key === 'video' && (video.url || video.videoUrl || video.playUrlInfo?.url)))
      continue
    const item = messageObject(raw)
    const action = messageActionTarget(item.url, item.webUrl, item.targetUrl, item.nativeUrl)
    const resourceType = type === 'general' ? action?.resourceType || type : type
    const tag = text(item.tag, 80)
    const rawId = item.id ?? item.resourceId ?? item.userId ?? item.vid ?? item.resId ?? ''
    const id =
      type === 'general' && action?.resourceId
        ? action.resourceId
        : typeof rawId === 'number' && !Number.isSafeInteger(rawId)
          ? ''
          : String(rawId)
    const artists = Array.isArray(item.artists)
      ? item.artists
      : Array.isArray(item.ar)
        ? item.ar
        : item.artist
          ? [item.artist]
          : []
    const artist =
      artists
        .slice(0, 30)
        .map((a: any) => text(a?.name))
        .filter(Boolean)
        .join(' / ')
        .slice(0, 1000) ||
      (type === 'general' &&
      (['song', 'album'].includes(resourceType) || ['歌曲', '专辑'].includes(tag))
        ? text(item.subTitle?.title || item.subTitle)
        : '')
    const subtitle =
      text(
        item.description ||
          item.content ||
          item.briefDesc ||
          item.subTitle?.title ||
          item.subTitle ||
          item.creator?.nickname,
      ) || artist
    attachments.push({
      kind: 'resource',
      resourceType,
      resourceId: id,
      title:
        text(item.name || item.title || item.nickname || item.mainTitle?.title || item.mainTitle) ||
        label,
      subtitle: subtitle || label,
      ...(tag ? { label: tag } : {}),
      ...(artist ? { artist } : {}),
      cover: mediaUrl(
        item.picUrl ||
          item.coverImgUrl ||
          item.coverUrl ||
          item.cover ||
          item.img1v1Url ||
          item.avatarUrl ||
          item.al?.picUrl ||
          item.album?.picUrl,
      ),
      actionUrl: action?.url || resourceLink(resourceType, id),
    })
  }
  if (data.file || root.msgType === 49) {
    const file = messageObject(data.file || body)
    attachments.push({
      kind: 'file',
      title: text(file.name || file.fileName) || '文件',
      subtitle: text(file.description),
      actionUrl: musicMessageLink(file.url) || neteaseAssetUrl(file.url),
    })
  }
  const parts = messageObject(data.msgRichText).contentTextList
  const richText: MessageTextPart[] = Array.isArray(parts)
    ? parts
        .slice(0, 100)
        .map((part) => ({
          text: text(part?.text),
          emphasized: part?.highLighted === true,
          url: musicMessageLink(part?.url || part?.orpheus),
        }))
        .filter((part) => part.text)
    : []
  return {
    ...(attachments.length ? { attachments: attachments.slice(0, 12) } : {}),
    ...(richText.length ? { richText } : {}),
  }
}
