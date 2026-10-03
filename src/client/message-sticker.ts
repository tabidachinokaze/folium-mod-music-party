import type { ChatEmoji } from '@party/shared/types'

// src/client/message-sticker.ts
// Keep message metadata out of attributes, and never infer it from unrelated cover images.
const stickers = new WeakMap<HTMLImageElement, ChatEmoji>()
export function markMessageSticker(image: HTMLImageElement, emoji: ChatEmoji | undefined) {
  if (emoji) stickers.set(image, emoji)
  return image
}
export function messageSticker(image: HTMLImageElement) {
  return stickers.get(image)
}
