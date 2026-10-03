import { expect, it } from 'vitest'
import { markMessageSticker, messageSticker } from '../src/client/message-sticker'
import { messageStickerSource } from '../src/shared/sticker-source'
import {
  hasSavedSticker,
  rememberSavedSticker,
  forgetSavedStickers,
} from '../src/client/sticker-collection'
import type { PartyController } from '../src/client/controller'
import type { ChatEmoji } from '@party/shared/types'

// tests/message-sticker-source.test.ts
const url = 'https://p1.music.126.net/message.gif'
const emoji: ChatEmoji = {
  emojiId: '12345678901234567890',
  emojiGroupId: '-1',
  emojiImgUrl: url,
  emojiName: 'Sticker',
  width: 32,
  height: 32,
  format: 'gif',
}
const image = (source = url) =>
  ({ src: source, naturalWidth: 32, naturalHeight: 32 }) as HTMLImageElement

it('offers adding actual image messages, including emoji ID zero, but never unmarked artwork or avatars', () => {
  expect(messageSticker(image())).toBeUndefined()
  expect(messageSticker(markMessageSticker(image(), undefined))).toEqual({
    kind: 'image',
    url,
    width: 32,
    height: 32,
  })
  expect(messageSticker(markMessageSticker(image(), { ...emoji, emojiId: '0' }))).toEqual({
    kind: 'image',
    url,
    width: 32,
    height: 32,
  })
  expect(messageSticker(markMessageSticker(image(), emoji))).toEqual(emoji)
})

it('refuses unsupported image origins, unreadable sizes and malformed sticker IDs', () => {
  for (const source of [
    'https://example.com/message.gif',
    'https://127.0.0.1/image',
    'file:///tmp/image',
    'data:image/gif;base64,AA',
  ])
    expect(messageStickerSource(source, undefined, 32, 32)).toBeUndefined()
  expect(messageStickerSource(url, undefined, 0, 32)).toBeUndefined()
  expect(messageStickerSource(url, undefined, 32000, 32)).toBeUndefined()
  expect(messageStickerSource(url, { ...emoji, emojiId: 'bad' }, 32, 32)).toBeUndefined()
})

it('recognizes saved image/sticker identities across views and removes them when deleted or the account changes', () => {
  const controller = { state: { account: { uid: '9' } } } as PartyController
  const source = { kind: 'image' as const, url, width: 32, height: 32 }
  const saved = { ...emoji, emojiImgUrl: 'https://p1.music.126.net/new-upload.gif' }
  expect(hasSavedSticker(controller, source)).toBe(false)
  rememberSavedSticker(controller, source, saved)
  expect(hasSavedSticker(controller, source)).toBe(true)
  expect(hasSavedSticker(controller, saved)).toBe(true)
  expect(
    hasSavedSticker(controller, { ...saved, emojiImgUrl: `${saved.emojiImgUrl}?param=120y120` }),
  ).toBe(true)
  forgetSavedStickers(controller, [saved.emojiId])
  expect(hasSavedSticker(controller, source)).toBe(false)
  expect(hasSavedSticker(controller, saved)).toBe(false)
  rememberSavedSticker(controller, saved)
  expect(hasSavedSticker(controller, saved)).toBe(true)
  controller.state.account = { uid: '10', nickname: 'other' }
  expect(hasSavedSticker(controller, saved)).toBe(false)
})
