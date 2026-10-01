import { expect, it } from 'vitest'
import { roomActivityText } from '../src/client/room-activity'

// tests/room-activity.test.ts
const activity = (nickname: string, text: string, ...titles: string[]) =>
  roomActivityText({
    nickname,
    text,
    attachments: titles.map((title) => ({ kind: 'resource', title })),
  })

it.each([
  ['小岛', '小岛来了，带来歌曲 我们俩 - 郭顶', '我们俩'],
  ['小岛', '小岛推荐了歌曲：《到时说爱我 - 茜拉》', '到时说爱我'],
  ['听友', '听友来了，带来歌曲 Booty Music - Deep Side', 'Booty Music'],
  ['[晚风].*', '[晚风].*来了，带来歌曲 글쎄 - SEVENTEEN', '글쎄'],
  ['tabidachinokaze', 'tabidachinokazeUP了《黄金数》', '黄金数'],
  ['小岛', '小岛置顶了歌曲《黄金数》', '黄金数'],
])(
  'keeps the complete official activity without repeating actor or title: %s / %s',
  (name, text, title) => {
    expect(activity(name, text, title)).toBe(text)
  },
)

it('supplies missing actor and attachment information without changing the body', () => {
  expect(activity('小岛', '为歌曲点赞')).toBe('小岛 · 为歌曲点赞')
  expect(activity('小岛', '推荐了一首歌', '我们俩')).toBe('小岛 · 推荐了一首歌 · 我们俩')
  expect(activity('小岛', '小岛推荐了歌曲', '我们俩')).toBe('小岛推荐了歌曲 · 我们俩')
  expect(activity('小岛', '带来歌曲 我们俩 - 郭顶', '我们俩')).toBe('小岛 · 带来歌曲 我们俩 - 郭顶')
  expect(activity('小岛', '', '我们俩')).toBe('小岛 · 我们俩')
})

it('keeps short titles and nickname prefixes that merely overlap ordinary words', () => {
  expect(activity('小', '小岛推荐给我一首歌', '我', '歌')).toBe('小 · 小岛推荐给我一首歌 · 我 / 歌')
  expect(activity('小岛', '晚风为小岛推荐了歌曲', '爱')).toBe('小岛 · 晚风为小岛推荐了歌曲 · 爱')
  expect(activity('晚风', '晚风推荐了歌曲《我》', '我')).toBe('晚风推荐了歌曲《我》')
})

it('supplements distinct titles once without mutating attachment data', () => {
  const message = {
    nickname: '小岛',
    text: '小岛推荐了歌曲《我们俩》',
    attachments: ['我们俩', '到时说爱我', '到时说爱我', 'Booty Music'].map((title) => ({
      kind: 'resource' as const,
      title,
    })),
  }
  const original = structuredClone(message)
  expect(roomActivityText(message)).toBe('小岛推荐了歌曲《我们俩》 · 到时说爱我 / Booty Music')
  expect(message).toEqual(original)
})

it('does not mistake words inside another song title for complete attachment titles', () => {
  expect(
    activity(
      '小岛',
      '小岛推荐了歌曲：《Love Yourself - 艾志恒Asen》',
      'Love Yourself',
      'Love',
      'Yourself',
    ),
  ).toBe('小岛推荐了歌曲：《Love Yourself - 艾志恒Asen》 · Love / Yourself')
})
