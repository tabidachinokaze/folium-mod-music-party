import type { Member, RoomQueueEntry, RoomSnapshot } from '@party/shared/types'
import type { HostSong } from './host'
import { withPromotionCount } from './queue-counts'
import { t } from './i18n'

// src/client/member-recommendations.ts
/** Playback may advance before the played-history endpoint includes the new occurrence. */
export function currentRoomRecommendation(
  room: RoomSnapshot,
  entries: RoomQueueEntry[],
  metadata: HostSong | null,
): RoomQueueEntry | null {
  const current = room.playback?.song
  if (!current) return null
  const known = entries.find((entry) => entry.songBizId === current.songBizId)
  const song = metadata?.source === 'netease' && metadata.id === current.songId ? metadata : null
  return {
    ...(known ??
      withPromotionCount(
        {
          ...current,
          track: {
            id: current.songId,
            name: song?.title || t('正在加载房间歌曲…'),
            artist: song?.artist || '',
            album: song?.album || '',
            cover: '',
            duration: room.playback?.duration ?? 0,
          },
          recommender: '',
          selfRecommended: false,
          uped: false,
          upCount: 0,
          liked: false,
          likeCount: 0,
        },
        undefined,
      )),
    ...current,
    likeCount: room.playback?.likeCount ?? known?.likeCount ?? 0,
  }
}

export function currentRecommendationOwner(
  room: RoomSnapshot,
  current: RoomQueueEntry | null,
): Member | null {
  if (!current) return null
  return (
    room.members.find((member) => member.uid === current.songRcmdUid) ?? {
      uid: current.songRcmdUid,
      nickname: current.songRcmdUid === '0' ? t('系统推荐') : current.recommender || t('听友'),
      avatar: '',
    }
  )
}

/** Keep recommendations distinct by business id; current playback belongs to played history. */
export function memberRecommendationGroups(
  uid: string,
  played: RoomQueueEntry[],
  waiting: RoomQueueEntry[],
  current: RoomQueueEntry | null,
) {
  const waitingRows = new Map(
    waiting
      .filter((entry) => entry.songBizId !== current?.songBizId)
      .map((entry) => [entry.songBizId, entry]),
  )
  const playedRows = new Map(
    [...(current ? [current] : []), ...played]
      .filter((entry) => !waitingRows.has(entry.songBizId))
      .map((entry) => [entry.songBizId, entry]),
  )
  // The live snapshot has the newest likes and recommender identity for the current entry.
  if (current) playedRows.set(current.songBizId, current)
  return {
    waiting: [...waitingRows.values()].filter((entry) => entry.songRcmdUid === uid),
    played: [...playedRows.values()].filter((entry) => entry.songRcmdUid === uid),
  }
}
