import type { ChatEmoji } from '@party/shared/types'
import { messageStickerSource } from '../shared/sticker-source'

// src/client/message-sticker.ts
// Keep message metadata out of attributes, and never infer it from unrelated cover images.
const stickers = new WeakMap<HTMLImageElement, { emoji?: ChatEmoji; url: string }>()
export function markMessageSticker(image: HTMLImageElement, emoji: ChatEmoji | undefined) {
  stickers.set(image, { emoji, url: emoji?.emojiImgUrl || image.src })
  return image
}
export function messageSticker(image: HTMLImageElement) {
  const source = stickers.get(image)
  if (!source) return
  return messageStickerSource(
    source.url,
    source.emoji,
    image.naturalWidth || source.emoji?.width || 0,
    image.naturalHeight || source.emoji?.height || 0,
  )
}
