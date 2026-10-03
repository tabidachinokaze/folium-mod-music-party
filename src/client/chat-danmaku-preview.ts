import type { ChatMessage } from '@party/shared/types'
import { t } from './i18n'

// Fixed local artwork keeps the settings preview independent of room media and
// network availability. It is the only data URL accepted by the preview renderer.
export const danmakuPreviewImage = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#ae78e5"/><circle cx="32" cy="32" r="22" fill="#30233e"/><circle cx="32" cy="32" r="9" fill="#f8c9d8"/><circle cx="32" cy="32" r="3" fill="#30233e"/><path d="M49 8v15c-7-2-8 6-3 6 4 0 6-2 6-5V13l5 2v-5z" fill="#fff"/></svg>',
)}`

export function danmakuPreviewMessages(batch: number): ChatMessage[] {
  const base = {
    uid: 'danmaku-preview',
    nickname: '',
    avatar: '',
    roomId: 'danmaku-preview',
    time: 0,
  }
  return [
    {
      ...base,
      id: `danmaku-preview-${batch}-text`,
      kind: 'text',
      text: t('一起听喜欢的音乐 😊 (｡･ω･｡)'),
    },
    {
      ...base,
      id: `danmaku-preview-${batch}-media`,
      kind: 'image',
      text: t('图片与表情'),
      attachments: [{ kind: 'image', title: t('图片与表情'), url: danmakuPreviewImage }],
    },
    {
      ...base,
      id: `danmaku-preview-${batch}-activity`,
      kind: 'resource',
      text: t('听友推荐了一首好歌'),
    },
  ]
}
