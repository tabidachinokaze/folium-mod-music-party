import { expect, it } from 'vitest'
import { roomActivityPresentation } from '../src/client/room-activity-presentation'
import { parseChatPage } from '@party/shared/chat'

// tests/room-activity-presentation.test.ts
const activity = (nickname: string, text: string, ...titles: string[]) => {
  const presentation = roomActivityPresentation({
    nickname,
    text,
    attachments: titles.map((title) => ({ kind: 'resource', resourceType: 'song', title })),
  })
  expect(presentation.parts.map((part) => part.text).join('')).toBe(presentation.text)
  return presentation
}
const songs = (result: ReturnType<typeof activity>) =>
  result.parts.filter((part) => part.kind === 'song').map((part) => part.text)

it.each([
  ['世萌沾坏', '世萌沾坏来了，带来歌曲 我们俩 - 郭顶', 'join', '我们俩'],
  ['世萌沾坏', '世萌沾坏推荐了歌曲：《到时说爱我 - 茜拉》', 'recommend', '到时说爱我'],
  ['[晚风].*', '[晚风].*来了，带来歌曲 글쎄 - SEVENTEEN', 'join', '글쎄'],
  ['tabidachinokaze', 'tabidachinokazeUP了《黄金数》', 'promote', '黄金数'],
  ['tabidachinokaze', 'tabidachinokaze浅赞一下《アプリコット》', 'like', 'アプリコット'],
  ['浅赞一下', '浅赞一下浅赞一下《Love - Yourself》', 'like', 'Love - Yourself'],
  ['小岛', '小岛置顶了歌曲《黄金数》', 'promote', '黄金数'],
  ['tabidachinokaze', 'tabidachinokaze红心了歌曲《黄金数》', 'redheart', '黄金数'],
])('distinguishes actor, action and complete song: %s / %s', (name, text, type, song) => {
  for (const titles of [[song], []]) {
    const result = activity(name, text, ...titles)
    expect(result.text).toBe(text)
    expect(result.type).toBe(type)
    expect(result.parts[0]).toEqual({ kind: 'actor', text: name })
    expect(songs(result)).toEqual([song])
  }
})

it.each([
  ['小岛', '为歌曲点赞', 'like', 'thumbs-up'],
  ['小岛', '小岛为歌曲《我们俩》点赞', 'like', 'thumbs-up'],
  ['小岛', '小岛点赞了歌曲《我们俩》', 'like', 'thumbs-up'],
  ['小岛', '浅赞一下《我们俩》', 'like', 'thumbs-up'],
  ['小岛', '小岛离开了房间', 'leave', 'log-out'],
  ['小岛', '小岛退出了', 'leave', 'log-out'],
  ['小岛', '小岛加入了房间', 'join', 'user-plus'],
  ['小岛', '推荐了一首歌', 'recommend', 'music-2'],
  ['小岛', '小岛红心了歌曲《我们俩》', 'redheart', 'heart'],
])('recognizes only a leading known action: %s / %s', (name, text, type, icon) => {
  expect(activity(name, text)).toMatchObject({ type, icon })
})

it('does not classify lyrics, titles or words about another actor as an event', () => {
  for (const [name, text] of [
    ['小', '小岛推荐给我一首歌'],
    ['小岛', '晚风为小岛推荐了歌曲'],
    ['小岛', '我喜欢的歌词是“你离开了我”'],
    ['小岛', '歌曲《来了，推荐了歌曲》'],
    ['小岛', '推荐了歌曲的那个朋友说再见'],
    ['小岛', '来了又走，留下了一首歌'],
    ['tabi', 'tabidachinokaze浅赞一下《アプリコット》'],
    ['小岛', '今天想浅赞一下《アプリコット》'],
    ['小岛', '浅赞一下《アプリコット》的歌词很好'],
    ['小岛', '浅赞一下这首歌'],
    ['小岛', '浅赞一下《》'],
    ['小岛', '今天听了红心了歌曲的歌词'],
    ['小岛', ''],
  ]) {
    expect(activity(name, text, '来了')).toMatchObject({ type: 'notice', icon: 'info' })
  }
})

it.each([
  [5, 'tabidachinokaze红心了歌曲《黄金数》', 'redheart', '红心', 'heart'],
  [3, 'tabidachinokaze浅赞一下《黄金数》', 'like', '点赞', 'thumbs-up'],
  [5, '收藏了这首歌', 'redheart', '红心', 'heart'],
  // Official structured type wins over a misleading textual template.
  [3, '红心了歌曲《黄金数》', 'like', '点赞', 'thumbs-up'],
] as const)(
  'preserves official room interactType %i through parsing and renders its distinct activity',
  (interactType, text, type, label, icon) => {
    const parsed = parseChatPage(
      {
        code: 200,
        data: {
          records: [
            {
              sendUid: '9',
              sendTime: 1791079200000,
              roomId: 'official_room',
              nickname: 'tabidachinokaze',
              msgType: 1,
              interactType,
              imChatRoomMsgBody: { text },
              resourceInfo: {
                resourceId: '123',
                bizId: '456',
                title: '黄金数',
                artistName: ['Artist'],
              },
            },
          ],
          page: { more: false },
        },
      },
      'official_room',
      '9',
    ).messages[0]
    expect(parsed).toMatchObject({ kind: 'interaction', interactType })
    const view = roomActivityPresentation(parsed)
    expect(view).toMatchObject({ type, label, icon })
    expect(view.parts.filter((part) => part.kind === 'actor')).toEqual([
      { kind: 'actor', text: 'tabidachinokaze' },
    ])
    expect(view.text.match(/tabidachinokaze/g)).toHaveLength(1)
    expect(view.parts.filter((part) => part.kind === 'song')).toEqual([
      { kind: 'song', text: '黄金数' },
    ])
  },
)

it('extracts the complete quoted song only from the official like template', () => {
  const result = activity('[晚风].*', '[晚风].*浅赞一下《 Love - Yourself 》！')
  expect(result.type).toBe('like')
  expect(result.icon).toBe('thumbs-up')
  expect(songs(result)).toEqual(['Love - Yourself'])
  expect(result.parts[0]).toEqual({ kind: 'actor', text: '[晚风].*' })
  expect(activity('小岛', '小岛推荐了歌曲《浅赞一下 - 歌手》').type).toBe('recommend')
  for (const text of ['小岛说“浅赞一下《アプリコット》”', '小岛浅赞一下《アプリコット》的歌词'])
    expect(songs(activity('小岛', text))).toEqual([])
})

it('marks short names and titles only within complete boundaries', () => {
  const overlap = activity('小', '小岛推荐给我一首歌', '我', '歌')
  expect(overlap.parts[0]).toEqual({ kind: 'actor', text: '小' })
  expect(songs(overlap)).toEqual(['我', '歌'])
  expect(overlap.parts.some((part) => part.text === ' · 小岛推荐给我一首歌 · ')).toBe(true)
  expect(songs(activity('晚风', '晚风推荐了歌曲《我》', '我'))).toEqual(['我'])
})

it('keeps distinct resources without highlighting fragments of a similar title', () => {
  const result = activity(
    '小岛',
    '小岛推荐了歌曲：《Love Yourself - 艾志恒Asen》',
    'Love Yourself',
    'Love',
    'Yourself',
    'Love',
  )
  expect(songs(result)).toEqual(['Love Yourself', 'Love', 'Yourself'])
  expect(result.text).toBe('小岛推荐了歌曲：《Love Yourself - 艾志恒Asen》 · Love / Yourself')
})

it('does not guess ambiguous unstructured song titles or change the original sentence', () => {
  const text = '小岛来了，带来歌曲 A - B - C'
  expect(songs(activity('小岛', text))).toEqual([])
  expect(activity('小岛', text).text).toBe(text)
  expect(songs(activity('小岛', '小岛推荐了歌曲：《我》'))).toEqual(['我'])
})

it('preserves unknown content and markup as literal strings, including empty activity', () => {
  const result = activity('<img>', '<img>发生了未知事件：<script>alert(1)</script>')
  expect(result.type).toBe('notice')
  expect(result.text).toBe('<img> · <img>发生了未知事件：<script>alert(1)</script>')
  expect(activity('', '').parts).toEqual([])
  expect(activity('小岛', '').parts).toEqual([{ kind: 'actor', text: '小岛' }])
})

it('does not label an album attachment as a song or mutate its input', () => {
  const message = {
    nickname: '小岛',
    text: '分享了专辑',
    attachments: [{ kind: 'resource' as const, resourceType: 'album', title: '范特西' }],
  }
  const original = structuredClone(message)
  expect(songs(roomActivityPresentation(message))).toEqual([])
  expect(message).toEqual(original)
})
