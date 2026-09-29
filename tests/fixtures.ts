import type { FoliumPlaybackQueue } from '../vendor/folium/contract'
import { vi } from 'vitest'
import type { Folium, HostSong, Intent, PlaybackState, PlaybackResult } from '../src/client/host'
import type { RoomPlayback } from '@party/shared/types'

// tests/fixtures.ts
export const song = (id = '1'): HostSong => ({
  id,
  source: 'netease',
  ref: `song-${id}`,
  title: `歌曲 ${id}`,
  artist: '歌手',
  album: null,
})
export function snapshot(id = '1', version = 1, sampledAt = 1000): RoomPlayback {
  return {
    song: { songId: id, songBizId: `10${version}`, songRcmdUid: '9' },
    nextSongs: [],
    version,
    playedTime: 20000,
    duration: 180000,
    sampledAt,
    forceSync: false,
    waitSongCount: 9,
  }
}
export function rawSnapshot() {
  return {
    roomId: 'official_room',
    multiLtRoomUserAgg: { onlineNums: 3, onlineUserInfos: [{ uid: 9, nickname: '我' }] },
    multiRoomInfoDTO: { chatRoomId: '888' },
    roomPlaySongInfo: {
      playSong: { songId: '1', songBizId: '101', songRcmdUid: '9' },
      version: 1 as const,
      playedTime: 20000,
      songDuration: 180000,
      nextSongs: [],
      waitSongCount: 9,
    },
  }
}
export function fakeHost() {
  const state: PlaybackState = { song: null, state: 'paused', position: 0, duration: 0 }
  const events = new Map<string, Set<(event: any) => void>>()
  const emit = (event: string, data: any) => events.get(event)?.forEach((fn) => fn(data))
  let dispatch = (_event: Intent) => {}
  const lease = {
    setQueue: vi.fn((_queue: FoliumPlaybackQueue) => {}),
    stop: vi.fn(() => {
      state.song = null
      state.state = 'stopped'
    }),
    play: vi.fn(async (song: HostSong): Promise<PlaybackResult> => {
      state.song = song
      state.duration = 180
      state.position = 0
      return { status: 'source-committed' as const }
    }),
    seek: vi.fn((seconds: number) => {
      state.position = seconds
    }),
    release: vi.fn(),
  }
  const bridge = {
    version: 2 as const,
    resolveSong: vi.fn(async (_: string, id: string) => song(id)),
    acquire: vi.fn(({ onIntent }: { onIntent: (event: Intent) => void }) => {
      dispatch = onIntent
      return lease
    }),
  }
  const folium: Folium = {
    env: { context: 'main' },
    internals: { omni: {} },
    experimental: { 'playback.sessions': bridge },
    rpc: { call: vi.fn() },
    playback: {
      getState: () => ({ ...state }),
      play: vi.fn(() => {
        state.state = 'playing'
        emit('playback.stateChanged', { state: 'playing' })
      }),
      pause: vi.fn(() => {
        state.state = 'paused'
        emit('playback.stateChanged', { state: 'paused' })
      }),
    },
    events: {
      on(name, fn) {
        if (!events.has(name)) events.set(name, new Set())
        events.get(name)!.add(fn)
        return () => {
          events.get(name)!.delete(fn)
        }
      },
    },
    ui: {
      navigate: vi.fn(),
      openPlayerPanel: vi.fn(),
      openHomeTab: vi.fn(),
      openQueue: vi.fn(),
      toast: vi.fn(),
      icon: vi.fn(),
    },
    registries: {},
  }
  return { folium, state, bridge, lease, emit, intent: (intent: Intent) => dispatch(intent) }
}
