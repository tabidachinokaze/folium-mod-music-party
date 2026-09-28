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
