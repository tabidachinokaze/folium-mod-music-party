import { describe, expect, it, vi } from 'vitest'
import { searchMatchSongs } from '../src/client/host'
import { fakeHost } from './fixtures'

// tests/match-song.test.ts
describe('matching song search host adapter', () => {
  it('uses only the Netease Omni provider and returns inert song DTOs', async () => {
    const { folium } = fakeHost()
    const search = vi.fn(async () => ({
      items: [
        {
          id: 12,
          name: '我们俩',
          artists: [{ name: '郭顶' }],
          album: { name: '微微' },
          sourceRef: { kind: 'online', providerId: 'netease', mediaId: '12' },
        },
        {
          id: 13,
          name: '合唱',
          artists: [{ name: '甲' }, { name: '乙' }],
          sourceRef: { kind: 'online', providerId: 'netease', mediaId: '13' },
        },
      ],
    }))
    folium.internals.omni.searchProviderSongs = search
    expect(await searchMatchSongs(folium, '  郭顶  ')).toEqual([
      { id: '12', source: 'netease', title: '我们俩', artist: '郭顶', album: '微微', ref: null },
      { id: '13', source: 'netease', title: '合唱', artist: '甲 / 乙', album: null, ref: null },
    ])
    expect(search).toHaveBeenCalledWith('netease', '郭顶', { limit: 30, offset: 0 })
    expect(folium.playback.play).not.toHaveBeenCalled()
    expect(folium.rpc.call).not.toHaveBeenCalled()
  })
  it('drops duplicates, other providers, malformed song IDs and non-song results', async () => {
    const { folium } = fakeHost()
    const item = (id: unknown, providerId = 'netease', kind = 'online') => ({
      id,
      sourceRef: { kind, providerId, mediaId: id },
    })
    folium.internals.omni.searchProviderSongs = vi.fn(async () => ({
      items: [
        item('10'),
        item('10'),
        item('0'),
        item('-1'),
        item('12abc'),
        item('3', 'qq'),
        item('4', 'netease', 'local'),
        null,
      ],
    }))
    expect(await searchMatchSongs(folium, 'test')).toEqual([
      { id: '10', source: 'netease', title: '歌曲 10', artist: '', album: null, ref: null },
    ])
  })
  it('does not query empty text and reports a missing host search capability', async () => {
    const { folium } = fakeHost()
    expect(await searchMatchSongs(folium, ' ')).toEqual([])
    await expect(searchMatchSongs(folium, 'test')).rejects.toThrow('暂不支持歌曲搜索')
  })
})
