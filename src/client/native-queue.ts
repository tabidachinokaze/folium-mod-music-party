import type {
  FoliumPlaybackQueue,
  FoliumQueueEntry,
  FoliumSong,
} from '../../vendor/folium/contract'
import type { PartyState } from './controller'
import { promotionCount } from './queue-counts'

// src/client/native-queue.ts
// Occurrences use official business IDs, even when the same recording was recommended twice.
export function nativeQueue(state: PartyState, resolved: FoliumSong | null): FoliumPlaybackQueue {
  const current = state.room?.playback?.song
  const queuedCurrent = state.queue.find((entry) => entry.songBizId === current?.songBizId)
  const metadata = resolved?.id === current?.songId ? resolved : null
  const entries: FoliumQueueEntry[] = state.queue
    .filter((entry) => entry.songBizId !== current?.songBizId)
    .map((entry) => ({
      id: entry.songBizId,
      track: {
        id: entry.songId,
        source: 'netease',
        title: entry.track.name,
        artist: entry.track.artist,
        coverUrl: entry.track.cover,
        duration: entry.track.duration / 1000,
      },
      actions: [
        {
          id: 'promote',
          label: { 'zh-CN': '置顶', en: 'Move to top' },
          icon: 'arrow-up-to-line',
          disabled: state.busy,
          count: promotionCount(entry),
        },
        ...(entry.songRcmdUid === state.account?.uid
          ? [
              {
                id: 'remove',
                label: { 'zh-CN': '删除我的推荐', en: 'Remove my recommendation' },
                icon: 'trash-2' as const,
                disabled: state.busy,
              },
            ]
          : []),
      ],
    }))
  if (current)
    entries.unshift({
      id: current.songBizId,
      track: {
        id: current.songId,
        source: 'netease',
        title: metadata?.title ?? queuedCurrent?.track.name ?? '正在加载房间歌曲…',
        artist: metadata?.artist ?? queuedCurrent?.track.artist ?? '',
        album: metadata?.album,
        coverUrl: queuedCurrent?.track.cover,
        duration: (state.room?.playback?.duration ?? 0) / 1000,
        ref: metadata?.ref,
      },
      actions: [
        {
          id: 'like',
          label: { 'zh-CN': '为这首歌点赞', en: 'Like this performance' },
          icon: 'thumbs-up',
          count: state.room?.playback?.likeCount ?? queuedCurrent?.likeCount ?? 0,
        },
      ],
    })
  return {
    entries,
    currentId: current?.songBizId ?? null,
    canNext: Boolean(current) && !state.busy,
    actions: [
      {
        id: 'sync',
        label: { 'zh-CN': '同步队列', en: 'Sync queue' },
        icon: 'refresh-cw',
        disabled: state.busy,
      },
    ],
    syncActionId: 'sync',
    totalCount: (state.room?.playback?.waitSongCount ?? state.queue.length) + (current ? 1 : 0),
    loading: state.queueLoading,
  }
}
