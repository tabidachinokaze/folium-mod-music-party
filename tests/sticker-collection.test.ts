import { expect, it, vi } from 'vitest'
import type { PartyController } from '../src/client/controller'
import {
  forgetSavedStickers,
  hasSavedSticker,
  rememberSavedSticker,
  stickerCollectionChanged,
  stickerCollectionRevision,
  subscribeStickerCollection,
} from '../src/client/sticker-collection'

const makeController = () => ({ state: { account: { uid: '9' } } }) as PartyController
const sticker = {
  emojiId: '20',
  emojiGroupId: '-1',
  emojiImgUrl: 'https://p1.music.126.net/test.gif',
  emojiName: 'test',
  width: 1,
  height: 1,
  format: 'gif',
}

it('broadcasts confirmed removals to both views after clearing saved aliases', () => {
  const controller = makeController()
  const source = {
    kind: 'image' as const,
    url: 'https://p1.music.126.net/source',
    width: 1,
    height: 1,
  }
  rememberSavedSticker(controller, source, sticker)
  const room = vi.fn(() => {
    expect(hasSavedSticker(controller, source)).toBe(false)
    expect(hasSavedSticker(controller, sticker)).toBe(false)
  })
  const privateView = vi.fn()
  const stopRoom = subscribeStickerCollection(controller, room)
  const stopPrivate = subscribeStickerCollection(controller, privateView)
  forgetSavedStickers(controller, ['20', '20'])
  expect(room).toHaveBeenCalledOnce()
  expect(privateView).toHaveBeenCalledWith({ uid: '9', revision: 1, removedIds: ['20'] })
  stopRoom()
  stickerCollectionChanged(controller)
  expect(room).toHaveBeenCalledOnce()
  expect(privateView).toHaveBeenLastCalledWith({ uid: '9', revision: 2, removedIds: undefined })
  stopPrivate()
})

it('does not treat loading cached items as a collection mutation', () => {
  const controller = makeController()
  const listener = vi.fn()
  const stop = subscribeStickerCollection(controller, listener)
  rememberSavedSticker(controller, sticker)
  forgetSavedStickers(controller, [])
  expect(stickerCollectionRevision(controller)).toBe(0)
  expect(listener).not.toHaveBeenCalled()
  stop()
})

it('isolates account saved flags and keeps subscriptions valid after switching accounts', () => {
  const controller = makeController()
  const listener = vi.fn()
  const stop = subscribeStickerCollection(controller, listener)
  rememberSavedSticker(controller, sticker)
  stickerCollectionChanged(controller)
  const oldRevision = stickerCollectionRevision(controller)
  controller.state.account = { uid: '10', nickname: 'another account' }
  expect(hasSavedSticker(controller, sticker)).toBe(false)
  stickerCollectionChanged(controller)
  expect(listener.mock.lastCall?.[0]).toMatchObject({ uid: '10' })
  expect(stickerCollectionRevision(controller)).toBeGreaterThan(oldRevision)
  expect(stickerCollectionRevision(makeController())).toBe(0)
  stop()
})
