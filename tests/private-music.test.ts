import { expect, it } from 'vitest'
import { parsePrivatePage } from '../vendor/music-party/src/shared/private-messages'
import { richMessageContent } from '../vendor/music-party/src/shared/message-content'

// tests/private-music.test.ts
const envelope = {
  id: 91,
  time: 1790917200000,
  fromUser: { userId: 10, nickname: '艺人' },
  toUser: { userId: 9, nickname: '听众' },
}

it('retains a legacy album announcement and its cover, title and singular artist metadata together', () => {
  const page = parsePrivatePage(
    {
      msgs: [
        {
          ...envelope,
          msg: JSON.stringify({
            msg: '我的最新专辑《Kids》发布了，快来抢先听！',
            album: {
              id: 700,
              name: 'Kids',
              picUrl: 'http://p1.music.126.net/fixture/kids.jpg',
              artist: { id: 55, name: '艺人名字' },
              description: '最新录音室专辑',
            },
          }),
        },
      ],
      more: false,
    },
    '9',
    '10',
  )
  expect(page.messages).toHaveLength(1)
  expect(page.messages[0]).toMatchObject({
    text: '我的最新专辑《Kids》发布了，快来抢先听！',
    attachments: [
      {
        kind: 'resource',
        resourceType: 'album',
        resourceId: '700',
        title: 'Kids',
        artist: '艺人名字',
        subtitle: '最新录音室专辑',
        cover: 'https://p1.music.126.net/fixture/kids.jpg',
        actionUrl: 'https://music.163.com/album?id=700',
      },
    ],
  })
})

it('retains song credits and artwork for legacy and message-center song/album shapes', () => {
  const song = {
    id: 701,
    name: '单曲标题',
    artists: [{ name: '歌手甲' }, { name: '歌手乙' }],
    album: { picUrl: 'https://p1.music.126.net/fixture/song.jpg' },
  }
  const legacy = richMessageContent({ song }).attachments![0]
  expect(legacy).toMatchObject({
    title: '单曲标题',
    artist: '歌手甲 / 歌手乙',
    subtitle: '歌手甲 / 歌手乙',
    cover: song.album.picUrl,
    resourceType: 'song',
  })
  expect(richMessageContent({ msgType: 30, body: JSON.stringify(song) }).attachments).toEqual([
    legacy,
  ])
  expect(
    richMessageContent({
      msgType: 31,
      body: { id: 702, name: '新版单曲', ar: [{ name: '歌手丙' }], al: song.album },
    }).attachments,
  ).toMatchObject([{ title: '新版单曲', artist: '歌手丙', cover: song.album.picUrl }])
  const album = parsePrivatePage(
    {
      msgs: [
        {
          ...envelope,
          msgType: 35,
          body: {
            id: 703,
            name: '新版专辑',
            artist: { name: '艺人丁' },
            picUrl: song.album.picUrl,
          },
        },
      ],
    },
    '9',
    '10',
  ).messages[0]
  expect(album.attachments).toMatchObject([
    { resourceType: 'album', title: '新版专辑', artist: '艺人丁', cover: song.album.picUrl },
  ])
})

it('does not invent missing artists or turn malformed media locations into cover requests', () => {
  const missing = richMessageContent({ album: { id: 700, name: 'Kids' } }).attachments![0]
  expect(missing.artist).toBeUndefined()
  const invalid = richMessageContent({
    album: {
      id: 701,
      name: '<script>still a title</script>',
      artists: [null, { name: 4 }, { name: '' }],
      picUrl: 'javascript:alert(1)',
    },
  }).attachments![0]
  expect(invalid.title).toBe('<script>still a title</script>')
  expect(invalid.artist).toBeUndefined()
  expect(invalid.cover).toBeUndefined()
  expect(
    richMessageContent({
      playlist: { id: 702, name: '歌单', creator: { nickname: '创建者' } },
    }).attachments,
  ).toMatchObject([{ title: '歌单', subtitle: '创建者', resourceType: 'playlist' }])
})

it.each([2, 47])('keeps images and shared songs attached to generic message type %s', (msgType) => {
  const attachments = richMessageContent({
    msgType,
    body: {
      picUrl: 'https://p1.music.126.net/fixture/promotion.jpg',
      song: { id: 701, name: '附带单曲', artists: [{ name: '歌手' }] },
      generalMsg: { title: '活动消息', subTitle: '附带图片与单曲' },
    },
  }).attachments!
  expect(attachments).toHaveLength(3)
  expect(attachments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'image',
        url: 'https://p1.music.126.net/fixture/promotion.jpg',
      }),
      expect.objectContaining({ kind: 'resource', resourceType: 'song', title: '附带单曲' }),
      expect.objectContaining({ kind: 'resource', resourceType: 'general', title: '活动消息' }),
    ]),
  )
})
