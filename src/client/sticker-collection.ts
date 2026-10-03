import type { PartyController } from './controller'
import type { ChatEmoji } from '@party/shared/types'
import { stickerSourceKeys, type MessageStickerSource } from '../shared/sticker-source'

// src/client/sticker-collection.ts
const revisions = new WeakMap<PartyController, number>()
const collections = new WeakMap<PartyController, { uid: string; saved: Map<string, string> }>()
function collection(controller: PartyController) {
  const uid = controller.state.account?.uid || ''
  let state = collections.get(controller)
  if (state?.uid !== uid) {
    state = { uid, saved: new Map() }
    collections.set(controller, state)
  }
  return state.saved
}
export function hasSavedSticker(controller: PartyController, source: MessageStickerSource) {
  const saved = collection(controller)
  return stickerSourceKeys(source).some((key) => saved.has(key))
}
export function rememberSavedSticker(
  controller: PartyController,
  source: MessageStickerSource,
  result?: ChatEmoji,
) {
  const saved = collection(controller)
  const id = result?.emojiId || ('emojiId' in source ? source.emojiId : '')
  for (const key of [...stickerSourceKeys(source), ...(result ? stickerSourceKeys(result) : [])])
    saved.set(key, id)
}
export function forgetSavedStickers(controller: PartyController, ids: string[]) {
  const saved = collection(controller)
  const removed = new Set(ids)
  for (const [key, id] of saved) if (removed.has(id)) saved.delete(key)
}
export const stickerCollectionRevision = (controller: PartyController) =>
  revisions.get(controller) || 0
export function stickerCollectionChanged(controller: PartyController) {
  revisions.set(controller, stickerCollectionRevision(controller) + 1)
}
