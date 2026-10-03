import type { ChatEmoji } from './types'
export interface StickerGroup {
  id: string
  name: string
  editable: boolean
}
export interface SavedSticker extends ChatEmoji {
  picId: string
  restricted: boolean
  restriction: string
}
export function stickerKey(item: SavedSticker): string {
  return item.emojiId !== '0' ? item.emojiId : `picture:${item.picId || item.emojiImgUrl}`
}
// Official chat collection uses the received emoji's identity, not a new NOS upload.
export function receivedStickerIdentity(value: unknown) {
  const item = value as { emojiId?: unknown; emojiGroupId?: unknown } | null
  const id = item?.emojiId, group = item?.emojiGroupId
  if ((typeof id === 'number' && !Number.isSafeInteger(id)) || !/^[1-9]\d{0,23}$/.test(String(id ?? '')))
    throw new Error('表情 ID 无效')
  if ((typeof group === 'number' && !Number.isSafeInteger(group)) || !/^-?\d{1,24}$/.test(String(group ?? '')))
    throw new Error('表情分组无效')
  return { emojiId: String(id), emojiGroupId: String(group) }
}
export function parseStickerGroups(body: any): StickerGroup[] {
  if (!Array.isArray(body?.data?.emojiGroups)) throw new Error('表情分组响应异常，请重试')
  return body.data.emojiGroups
    .filter((group: any) => group?.edit === true)
    .map((group: any) => {
      if (typeof group.id === 'number' && !Number.isSafeInteger(group.id))
        throw new Error('表情分组 ID 精度异常')
      const id = String(group.id)
      if (!/^-?\d{1,24}$/.test(id)) throw new Error('表情分组 ID 无效')
      return {
        id,
        name: typeof group.name === 'string' ? group.name : '自定义表情',
        editable: true,
      }
    })
}
