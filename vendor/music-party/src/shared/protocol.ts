import type { MultiInvitation, Room, Song } from './types'

export function parseInvitation(input: string): MultiInvitation {
  // Clipboard text from Markdown editors can contain literal \& or HTML-escaped separators.
  // Normalize only separators; do not decode arbitrary percent escapes or accept other hosts.
  const normalized = input
    .trim()
    .replace(/\\&/g, '&')
    .replace(/&amp;|&#0*38;|&#x0*26;/gi, '&')
  const destination = normalized.match(/\]\(\s*<?(https:\/\/[^\s<>"\)]+)>?\s*\)/)
  const match = destination || normalized.match(/https:\/\/[^\s<>"“”\]\)]+/)
  if (!match) throw new Error('请粘贴网易云多人一起听的完整邀请链接')
  let url: URL
  try {
    url = new URL(destination ? destination[1] : match[0])
  } catch {
    throw new Error('邀请链接格式不正确')
  }
  if (url.hostname !== 'st.music.163.com' || url.username || url.password || url.port)
    throw new Error('请使用网易云官方多人邀请链接')
  const path = url.pathname.replace(/\/$/, '')
  if (path === '/listen-together/share')
    throw new Error('这是双人一起听邀请，请从官方 App 的多人房间复制链接')
  if (path !== '/listen-together/multishare/index.html')
    throw new Error('不是受支持的网易云多人邀请链接')
  if (
    url.searchParams.getAll('roomId').length !== 1 ||
    url.searchParams.getAll('inviterUid').length !== 1 ||
    url.searchParams.getAll('isFLT').length > 1
  )
    throw new Error('邀请参数重复或缺失')
  if (url.searchParams.has('isFLT') && url.searchParams.get('isFLT') !== 'false')
    throw new Error('此链接是跟听模式，目前仅接入官方多人一起听')
  const roomId = url.searchParams.get('roomId') || ''
  const inviterUid = url.searchParams.get('inviterUid') || ''
  if (!/^[\w-]{1,128}$/.test(roomId) || !/^\d{1,24}$/.test(inviterUid))
    throw new Error('邀请缺少有效的 roomId 或 inviterUid')
  return { roomId, inviterUid, isFLT: false }
}

export function invitation(room: Room): string {
  const url = new URL('https://st.music.163.com/listen-together/multishare/index.html')
  url.searchParams.set('roomId', room.roomId)
  url.searchParams.set('inviterUid', room.inviterUid)
  url.searchParams.set('isFLT', 'false')
  return url.toString()
}

export function toSong(song: any): Song {
  return {
    id: String(song.id),
    name: song.name || '未知歌曲',
    artist: (song.ar || song.artists || []).map((a: any) => a.name).join(' / '),
    album: (song.al || song.album)?.name || '',
    cover: (song.al || song.album)?.picUrl || '',
    duration: song.dt || song.duration || 0,
  }
}

export function queueIds(body: any): string[] | null {
  const ids = body?.data?.playlist?.displayList?.result
  return Array.isArray(ids) && ids.every((id) => /^\d+$/.test(String(id))) ? ids.map(String) : null
}

// Keep protocol diagnostics useful without exporting account credentials, URLs or private messages.
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /cookie|token|secret|authorization|password|MUSIC_[UA]|csrf|NMTID|qrimg|qrurl|unikey|^key$|avatar|nickname|^url$|^msg$|^text$|msgBody|msgRichText|mainStateText|^content$|^emoji$/i.test(
          key,
        )
          ? '[已隐藏]'
          : redact(item),
      ]),
    )
  if (typeof value === 'string')
    return value
      .replace(/https?:\/\/\S+/g, '[链接已隐藏]')
      .replace(/(?:MUSIC_[UA]|__csrf|NMTID)=[^;\s]+/g, '[凭据已隐藏]')
  return value
}

export class SerialCommands {
  private tail: Promise<unknown> = Promise.resolve()
  private sequence = 0
  run<T>(task: (sequence: number) => Promise<T>): Promise<T> {
    const next = this.tail.then(() => task(++this.sequence))
    this.tail = next.catch(() => undefined)
    return next
  }
}
