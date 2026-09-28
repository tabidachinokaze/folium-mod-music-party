import type { QueueSong, RoomPlayback, RoomQueueEntry } from './types'
export function parseRoomQueue(body: any): {
  entries: RoomQueueEntry[]
  more: boolean
  cursor: string | null
} {
  const data = body?.data
  if (!Array.isArray(data?.songLists)) throw new Error('待播列表响应异常，请重试')
  const entries = data.songLists.map((item: any): RoomQueueEntry => {
    const song = item?.songInfo
    const id = (value: unknown) => {
      if (typeof value === 'number' && !Number.isSafeInteger(value))
        throw new Error('待播歌曲 ID 精度异常')
      const text = String(value ?? '')
      if (!/^\d{1,24}$/.test(text)) throw new Error('待播歌曲条目异常')
      return text
    }
    const songId = id(song?.resourceId)
    return {
      songId,
      songBizId: id(song?.bizId),
      songRcmdUid: id(item.rcmdUid ?? 0),
      recommender: typeof item.nickname === 'string' ? item.nickname : '',
      selfRecommended: item.selfRcmd === true,
      uped: item.uped === true,
      upCount: Math.max(0, Number(song.upCnt) || 0),
      liked: item.liked === true,
      likeCount: Math.max(0, Number(song.zanCnt) || 0),
      track: {
        id: songId,
        name: song.title || '未知歌曲',
        artist: Array.isArray(song.artistName) ? song.artistName.join(' / ') : '',
        cover: song.coverUrl || '',
        album: '',
        duration: 0,
      },
    }
  })
  return {
    entries,
    more: data.page?.more === true,
    cursor: typeof data.page?.cursor === 'string' && data.page.cursor ? data.page.cursor : null,
  }
}
export function waitingSongs(songs: QueueSong[], currentBizId?: string): QueueSong[] {
  const seen = new Set<string>()
  return songs.filter((song) => {
    if (song.songBizId === currentBizId || seen.has(song.songBizId)) return false
    seen.add(song.songBizId)
    return true
  })
}
export function waitingCount(playback: RoomPlayback | null): number | undefined {
  if (!playback) return undefined
  return Math.max(
    playback.waitSongCount,
    waitingSongs(playback.nextSongs, playback.song?.songBizId).length,
  )
}
