import type { PartyController } from './controller'
import { button, el } from './dom'

// src/client/private-tools.ts
export type PrivateRun = (task: () => Promise<unknown>) => Promise<void>
export async function uploadImage(
  controller: PartyController,
  file: File,
  target: { kind: 'sticker' } | { kind: 'private'; uid: string },
) {
  if (
    !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) ||
    !file.size ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error('请选择 20 MB 以内的 PNG、JPEG、GIF 或 WebP 图片')
  const account = controller.state.account?.uid
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result).split(',')[1])
      reader.onerror = () => reject(new Error('无法读取图片'))
      reader.readAsDataURL(file)
    })
    if (!account || controller.state.account?.uid !== account)
      throw new Error('账号已变化，请重新选择图片')
    return await controller.connection.attachment('media', {
      requestId: crypto.randomUUID(),
      target,
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
  const popups: HTMLDetailsElement[] = []
  const create = (label: string, values: string[]) => {
    const box = el('details', 'mp-stickers'),
      content = el('div', 'mp-sticker-content mp-text-picker')
    box.append(el('summary', '', label))
    content.append(el('h3', '', label))
    const grid = el('div', 'mp-text-grid')
    values.forEach((value) =>
      grid.append(
        button(value, () => {
          if (draft.value.length + value.length > draft.maxLength) return
          draft.setRangeText(value, draft.selectionStart, draft.selectionEnd, 'end')
          draft.focus()
          box.open = false
        }),
      ),
    )
    content.append(grid)
    box.append(content)
    popups.push(box)
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
        await send((uid) => uploadImage(controller, file, { kind: 'private', uid }))
        image.open = false
      }),
  )
  image.append(el('summary', '', '图片'))
  content.append(
    el('h3', '', '发送图片'),
    el('p', 'mp-muted', 'PNG、JPEG、GIF、WebP · 最大 20 MB'),
    button('选择图片', () => input.click()),
    input,
  )
  image.append(content)
  popups.push(image)
  const close = () =>
    popups.forEach((box) => {
      box.open = false
    })
  const outside = (event: Event) =>
    popups.forEach((box) => {
      if (!event.composedPath().includes(box)) box.open = false
    })
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close()
  }
  document.addEventListener('pointerdown', outside)
  document.addEventListener('keydown', escape)
  return {
    nodes,
    image,
    close,
    dispose() {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    },
  }
}
