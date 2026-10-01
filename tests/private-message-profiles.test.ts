import { expect, it } from 'vitest'
import { privateMessageProfiles } from '../src/client/private-message'

// tests/private-message-profiles.test.ts
it('uses sender and recipient profiles from either direction of the selected private conversation', () => {
  const self = { userId: 9, nickname: '我', avatarUrl: 'https://p1.music.126.net/self.png' },
    peer = { userId: '10', nickname: '听友', avatarUrl: 'https://p1.music.126.net/peer.png' }
  const profiles = privateMessageProfiles(
    {
      msgs: [
        { fromUser: peer, toUser: self },
        { fromUser: self, toUser: peer },
        { fromUser: { userId: 9 }, toUser: { userId: 10 } },
      ],
    },
    '9',
    '10',
  )
  expect([...profiles.values()]).toEqual([
    { uid: '10', nickname: '听友', avatar: peer.avatarUrl },
    { uid: '9', nickname: '我', avatar: self.avatarUrl },
  ])
})
it('ignores unrelated messages and malformed identities instead of borrowing another user avatar', () => {
  const profiles = privateMessageProfiles(
    {
      msgs: [
        null,
        {},
        { fromUser: { userId: 9 }, toUser: { userId: 11, nickname: '其他用户' } },
        { fromUser: { userId: 11 }, toUser: { userId: 10, avatarUrl: 'wrong' } },
        {
          fromUser: { userId: '9', nickname: 20, avatarUrl: {} },
          toUser: { userId: '10', nickname: '', avatarUrl: null },
        },
      ],
    },
    '9',
    '10',
  )
  expect([...profiles.values()]).toEqual([
    { uid: '9', nickname: '', avatar: '' },
    { uid: '10', nickname: '', avatar: '' },
  ])
  expect(privateMessageProfiles(null, '9', '10').size).toBe(0)
})
