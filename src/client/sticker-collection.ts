import type { PartyController } from './controller'

// src/client/sticker-collection.ts
const revisions = new WeakMap<PartyController, number>()
export const stickerCollectionRevision = (controller: PartyController) =>
  revisions.get(controller) || 0
export function stickerCollectionChanged(controller: PartyController) {
  revisions.set(controller, stickerCollectionRevision(controller) + 1)
}
