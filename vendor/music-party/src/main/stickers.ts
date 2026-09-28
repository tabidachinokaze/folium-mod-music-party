import { createHash } from 'node:crypto'
import { parseEmoji } from '../shared/message-content'
import type { SavedSticker } from '../shared/stickers'

export function imageUrlForPicId(value: unknown): string | undefined {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw new Error('表情图片 ID 精度异常，请使用内置 API')
  const id = String(value ?? '')
  if (!/^[1-9]\d{0,23}$/.test(id)) return
  const key = Buffer.from('3go8&$8*3*3h0k(2)2'),
    bytes = Buffer.from(id)
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= key[i % key.length]
  const hash = createHash('md5')
    .update(bytes)
    .digest('base64')
    .replaceAll('/', '_')
    .replaceAll('+', '-')
  return `https://p1.music.126.net/${hash}/${id}.jpg`
}
export function savedSticker(raw: any, groupId?: string): SavedSticker | null {
  if (!raw || typeof raw !== 'object') return null
  const picId = String(raw.picId ?? '')
  const fallback = imageUrlForPicId(raw.picId)
  const emoji = parseEmoji({
    ...raw,
    emojiGroupId: raw.emojiGroupId ?? groupId ?? '0',
    emojiImgUrl: raw.emojiImgUrl || fallback,
  })
  if (!emoji) return null
  return {
    ...emoji,
    picId,
    restricted: raw.enable === false || raw.disabled === true,
    restriction: typeof raw.vipMessage === 'string' ? raw.vipMessage : '此表情暂不可用',
  }
}
export function normalizeStickerPage(body: any, groupId: string) {
  if (!Array.isArray(body?.data?.emojis)) throw new Error('自定义表情响应异常，请重试')
  const items = body.data.emojis.map((raw: any) => savedSticker(raw, groupId)).filter(Boolean)
  return {
    ...body,
    data: { ...body.data, emojis: items, unavailable: body.data.emojis.length - items.length },
  }
}
