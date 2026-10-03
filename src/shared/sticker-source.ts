import type { ChatEmoji } from '@party/shared/types'
import { neteaseAssetUrl } from '@party/shared/media'
import { receivedStickerIdentity } from '@party/shared/stickers'

// src/shared/sticker-source.ts
export interface MessageStickerImage {
  kind: 'image'
  url: string
  width: number
  height: number
}
export type MessageStickerSource = ChatEmoji | MessageStickerImage

export function messageStickerSource(
  url: string,
  emoji: ChatEmoji | undefined,
  width: number,
  height: number,
): MessageStickerSource | undefined {
  if (emoji && emoji.emojiId !== '0') {
    try {
      receivedStickerIdentity(emoji)
      return emoji
    } catch {
      return
    }
  }
  const safe = neteaseAssetUrl(url)
  if (
    !safe ||
    [width, height].some((value) => !Number.isSafeInteger(value) || value <= 0 || value > 30000)
  )
    return
  return { kind: 'image', url: safe, width, height }
}

export function stickerSourceKeys(source: MessageStickerSource): string[] {
  const url = neteaseAssetUrl('url' in source ? source.url : source.emojiImgUrl)
  const keys: string[] = []
  if ('emojiId' in source && /^[1-9]\d{0,23}$/.test(source.emojiId))
    keys.push(`emoji:${source.emojiId}`)
  if (url) {
    const image = new URL(url)
    // CDN resize parameters do not change which stored image this is.
    keys.push(`image:${image.origin}${image.pathname}`)
  }
  return keys
}
