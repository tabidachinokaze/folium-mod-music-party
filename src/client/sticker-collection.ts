import type { PartyController } from './controller'
import type { ChatEmoji } from '@party/shared/types'
import { stickerSourceKeys, type MessageStickerSource } from '../shared/sticker-source'

// src/client/sticker-collection.ts
export interface StickerCollectionChange {
  uid: string
  revision: number
  removedIds?: readonly string[]
}
type CollectionState = {
  uid: string
  revision: number
  saved: Map<string, string>
  listeners: Set<(change: StickerCollectionChange) => void>
}
const collections = new WeakMap<PartyController, CollectionState>()
function collection(controller: PartyController) {
  const uid = controller.state.account?.uid || ''
  let state = collections.get(controller)
  if (!state) {
    state = { uid, revision: 0, saved: new Map(), listeners: new Set() }
    collections.set(controller, state)
  } else if (state.uid !== uid) {
    state.uid = uid
    state.revision++
    state.saved.clear()
  }
  return state
}
export function hasSavedSticker(controller: PartyController, source: MessageStickerSource) {
  const { saved } = collection(controller)
  return stickerSourceKeys(source).some((key) => saved.has(key))
}
export function rememberSavedSticker(
  controller: PartyController,
  source: MessageStickerSource,
  result?: ChatEmoji,
) {
  const { saved } = collection(controller)
  const id = result?.emojiId || ('emojiId' in source ? source.emojiId : '')
  for (const key of [...stickerSourceKeys(source), ...(result ? stickerSourceKeys(result) : [])])
    saved.set(key, id)
}
export function forgetSavedStickers(controller: PartyController, ids: string[]) {
  const { saved } = collection(controller)
  const removed = new Set(ids)
  for (const [key, id] of saved) if (removed.has(id)) saved.delete(key)
  if (removed.size) changed(controller, [...removed])
}
export const stickerCollectionRevision = (controller: PartyController) =>
  collection(controller).revision
export function subscribeStickerCollection(
  controller: PartyController,
  listener: (change: StickerCollectionChange) => void,
) {
  const state = collection(controller)
  state.listeners.add(listener)
  return () => {
    state.listeners.delete(listener)
  }
}
function changed(controller: PartyController, removedIds?: readonly string[]) {
  const state = collection(controller)
  const change = { uid: state.uid, revision: ++state.revision, removedIds }
  for (const listener of [...state.listeners]) listener(change)
}
export function stickerCollectionChanged(controller: PartyController) {
  changed(controller)
}
