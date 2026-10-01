import type { PartyController } from './controller'
import { button, el } from './dom'
import { mountDetailsPopup } from './popup-position'
import { t } from './i18n'

// src/client/private-tools.ts
export type PrivateRun = (task: () => Promise<unknown>) => Promise<void>
export async function uploadImage(
  controller: PartyController,
  file: File,
  target: { kind: 'sticker' } | { kind: 'private'; uid: string } | { kind: 'room'; roomId: string },
) {
  if (
    !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) ||
    !file.size ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error(t('请选择 20 MB 以内的 PNG、JPEG、GIF 或 WebP 图片'))
  const account = controller.state.account?.uid
  const destination = { ...target }
  const checkRoom = () => {
    if (destination.kind === 'room' && controller.state.room?.roomId !== destination.roomId)
      throw new Error(t('房间已变化，请重新选择图片'))
  }
  checkRoom()
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.onerror = () => reject(new Error(t('无法读取图片')))
      reader.readAsDataURL(file)
    })
    if (!account || controller.state.account?.uid !== account)
      throw new Error(t('账号已变化，请重新选择图片'))
    checkRoom()
    return await controller.connection.attachment('media', {
      requestId: crypto.randomUUID(),
      target: destination,
      file: {
        kind: 'image',
        name: file.name,
        mime: file.type,
        width: img.naturalWidth,
        height: img.naturalHeight,
        base64,
      },
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}
export function imageInput(action: (file: File) => void) {
  const input = el('input')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/gif,image/webp'
  input.hidden = true
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    input.value = ''
    if (file) action(file)
  })
  return input
}
export function createPrivateTools(
  controller: PartyController,
  draft: HTMLTextAreaElement,
  run: PrivateRun,
  send: (task: (uid: string) => Promise<unknown>) => Promise<void>,
) {
  return createComposerTools(controller, draft, run, (file) =>
    send((uid) => uploadImage(controller, file, { kind: 'private', uid })),
  )
}
export function createComposerTools(
  controller: PartyController,
  draft: HTMLTextAreaElement,
  run: PrivateRun,
  onImage: (file: File) => Promise<unknown>,
) {
  const popups: ReturnType<typeof mountDetailsPopup>[] = []
  const create = (label: string, values: string[]) => {
    const box = el('details', 'mp-stickers'),
      content = el('div', 'mp-sticker-content mp-text-picker')
    if (label === '颜文字') content.classList.add('mp-kaomoji')
    box.append(el('summary', '', t(label)))
    content.append(el('h3', '', t(label)))
    const grid = el('div', 'mp-text-grid')
    values.forEach((value) =>
      grid.append(
        button(value, () => {
          const length =
            draft.value.length - (draft.selectionEnd - draft.selectionStart) + value.length
          if (draft.maxLength >= 0 && length > draft.maxLength) return
          draft.setRangeText(value, draft.selectionStart, draft.selectionEnd, 'end')
          draft.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
          draft.focus()
          box.open = false
        }),
      ),
    )
    content.append(grid)
    box.append(content)
    popups.push(mountDetailsPopup(box, content))
    return box
  }
  const nodes = [
    create('Emoji', [
      '😀',
      '😊',
      '😂',
      '🥰',
      '😍',
      '🥹',
      '😎',
      '🤔',
      '😭',
      '😴',
      '🥳',
      '🤗',
      '👍',
      '👏',
      '🫶',
      '❤️',
      '💙',
      '✨',
      '🎵',
      '🎧',
      '🌙',
      '☀️',
      '🌸',
      '🍀',
    ]),
    create('颜文字', [
      '(｡･ω･｡)',
      '(≧▽≦)',
      '( •̀ ω •́ )✧',
      '(づ｡◕‿‿◕｡)づ',
      '(´･_･`)',
      '╮(╯▽╰)╭',
      '(T_T)',
      '٩(ˊᗜˋ*)و',
    ]),
  ]
  const image = el('details', 'mp-stickers'),
    content = el('div', 'mp-sticker-content mp-image-picker')
  const input = imageInput(
    (file) =>
      void run(async () => {
        if (!controller.state.account) throw new Error(t('请先登录网易云账号'))
        await onImage(file)
        image.open = false
      }),
  )
  image.append(el('summary', '', t('图片')))
  content.append(
    el('h3', '', t('发送图片')),
    el('p', 'mp-muted', t('PNG、JPEG、GIF、WebP · 最大 20 MB')),
    button(t('选择图片'), () => input.click()),
    input,
  )
  image.append(content)
  popups.push(mountDetailsPopup(image, content))
  const close = () => popups.forEach((popup) => popup.close())
  return {
    nodes,
    image,
    close,
    dispose() {
      popups.forEach((popup) => popup.dispose())
    },
  }
}
