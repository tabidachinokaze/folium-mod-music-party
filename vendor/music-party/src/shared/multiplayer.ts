import type { QueueSong, RoomPlayback, RoomSnapshot } from './types'

function id(value: unknown): string {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error('房间 ID 精度异常，请更新 API')
  const result = String(value ?? '')
  if (!/^\d{1,24}$/.test(result)) throw new Error('多人房间歌曲或用户 ID 无效')
  return result
}
function finite(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}
function queueSong(value: any): QueueSong {
  return {
    songId: id(value.songId),
    songBizId: id(value.songBizId),
    songRcmdUid: id(value.songRcmdUid ?? 0),
  }
}
export function parseRoomPlayback(value: any, sampledAt: number): RoomPlayback | null {
  if (!value || !Object.hasOwn(value, 'playSong')) return null
  if (!Number.isSafeInteger(value.version) || value.version < 0) throw new Error('房间歌曲版本无效')
  if (!Number.isFinite(value.playedTime) || value.playedTime < 0)
    throw new Error('房间播放进度无效')
  const nextSongs = Array.isArray(value.nextSongs) ? value.nextSongs.map(queueSong) : []
  return {
    song: value.playSong ? queueSong(value.playSong) : null,
    nextSongs,
    version: value.version,
    playedTime: value.playedTime,
    duration: finite(value.songDuration),
    sampledAt,
    forceSync: value.forceSync === true,
    waitSongCount: finite(value.waitSongCount, nextSongs.length),
    likeCount: finite(value.playingSongZanCnt),
  }
}
export function parseSnapshot(value: any, sampledAt: number): RoomSnapshot {
  if (!value || typeof value.roomId !== 'string' || !/^[\w-]{1,128}$/.test(value.roomId))
    throw new Error('响应缺少官方多人房间快照，请查看观测记录')
  // Wire names are @JSONField aliases in the official Android models.
  const users = value.multiLtRoomUserAgg ?? value.roomUserList
  const info = value.multiRoomInfoDTO ?? value.roomInfo
  const rawMembers = users?.onlineUserInfos ?? info?.roomUsers
  const members = new Map<string, import('./types').Member>()
  if (Array.isArray(rawMembers))
    for (const member of rawMembers) {
      try {
        const uid = id(member?.uid ?? member?.userId)
        members.set(uid, {
          uid,
          nickname: typeof member.nickname === 'string' ? member.nickname : '听友',
          avatar:
            typeof (member.avatar ?? member.avatarUrl) === 'string'
              ? (member.avatar ?? member.avatarUrl)
              : '',
        })
      } catch {
        /* A malformed member must not interrupt music playback. */
      }
    }
  const onlineCount =
    Number.isInteger(users?.onlineNums) && users.onlineNums >= 0
      ? users.onlineNums
      : Array.isArray(rawMembers)
        ? members.size
        : null
  const chatId = info?.chatRoomId
  const chatRoomId =
    (typeof chatId === 'string' || (typeof chatId === 'number' && Number.isSafeInteger(chatId))) &&
    /^[1-9]\d{0,23}$/.test(String(chatId))
      ? String(chatId)
      : null
  return {
    roomId: value.roomId,
    creatorId: info?.creatorId == null ? undefined : String(info.creatorId),
    createdAt: finite(info?.roomCreateTime) || undefined,
    tags: Array.isArray(value.roomTagList) ? value.roomTagList.filter((tag: unknown) => typeof tag === "string") : [],
    playback: parseRoomPlayback(value.roomPlaySongInfo, sampledAt),
    members: [...members.values()],
    membersKnown: Array.isArray(rawMembers),
    onlineCount,
    chatRoomId,
  }
}
export function targetPosition(state: RoomPlayback, now: number): number {
  const progress = state.playedTime + Math.max(0, now - state.sampledAt)
  return state.duration > 0 ? Math.min(progress, Math.max(0, state.duration - 100)) : progress
}
export function shouldAccept(previous: RoomPlayback | null, next: RoomPlayback): boolean {
  return !previous || (next.version >= previous.version && next.sampledAt >= previous.sampledAt)
}
// Official heartBeatDuration is seconds; playedTime/songDuration are milliseconds.
export function heartbeatInterval(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1000, Math.min(value * 1000, 60000))
    : 5000
}
