import { expect, it } from 'vitest'
import { parsePrivatePage } from '@party/shared/private-messages'
import { parseChatPage } from '@party/shared/chat'

// tests/received-stickers.test.ts
const emoji = {
  emojiId: '12345678901234567890',
  emojiGroupId: '-1',
  emojiName: '收到的表情',
  emojiImgUrl: 'https://p1.music.126.net/fixture/109951166199016466.jpg',
  width: 120,
  height: 180,
  format: 'gif',
}
it('preserves received private sticker metadata across both legacy and message-center envelopes', () => {
  const common = { time: 1790917200000, fromUser: { userId: 10 }, toUser: { userId: 9 } }
  const msgs = [
    {
      ...common,
      id: 1,
      msg: JSON.stringify({ emoji, msg: '（升级App到最新版本即可查看该消息）' }),
    },
    {
      ...common,
      id: 2,
      msgType: 1,
      msg: '（升级App到最新版本即可查看该消息）',
      body: JSON.stringify({ ...emoji, url: emoji.emojiImgUrl, name: emoji.emojiName }),
    },
  ]
  const messages = parsePrivatePage({ msgs }, '9', '10').messages
  expect(messages).toHaveLength(2)
  for (const message of messages)
    expect(message.attachments).toEqual([
      expect.objectContaining({ kind: 'image', url: emoji.emojiImgUrl, emoji }),
    ])
})
it('retains exact room sticker IDs for collection actions without treating resource artwork as a sticker', () => {
  const message = parseChatPage(
    {
      data: {
        records: [
          {
            sendUid: '10',
            sendTime: 1,
            msgType: 0,
            emoji,
            imChatRoomMsgBody: { text: '[收到的表情]' },
          },
        ],
      },
    },
    'room',
    '9',
  ).messages[0]
  expect(message.attachments![0].emoji).toEqual(emoji)
})
