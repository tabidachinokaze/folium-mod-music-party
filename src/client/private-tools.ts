import type { PartyController } from './controller'
import { button, el } from './dom'
import { mountDetailsPopup } from './popup-position'
import { t } from './i18n'
import { createImageDraftPicker, validateImageFile } from './image-draft'

// src/client/private-tools.ts
export type PrivateRun = (task: () => Promise<unknown>) => Promise<void>
export async function uploadImage(
  controller: PartyController,
  file: File,
  target: { kind: 'sticker' } | { kind: 'private'; uid: string } | { kind: 'room'; roomId: string },
  isCurrent: () => boolean = () => true,
) {
  validateImageFile(file)
  const account = controller.state.account?.uid
  const destination = { ...target }
  const checkRoom = () => {
    if (!isCurrent()) throw new Error(t('聊天已变化，请重新选择图片'))
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
  peer: () => string | null,
) {
  return createComposerTools(
    controller,
    draft,
    run,
    (file, isCurrent) =>
      send((uid) => uploadImage(controller, file, { kind: 'private', uid }, isCurrent)),
    peer,
  )
}
export function createComposerTools(
  controller: PartyController,
  draft: HTMLTextAreaElement,
  run: PrivateRun,
  onImage: (file: File, isCurrent: () => boolean) => Promise<unknown>,
  destination: () => string | null,
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
  const image = createImageDraftPicker({
    draft,
    run,
    send: onImage,
    context: () => {
      const account = controller.state.account?.uid,
        target = destination()
      return account && target ? JSON.stringify([account, target]) : null
    },
  })
  const close = () => {
    popups.forEach((popup) => popup.close())
    image.close()
  }
  return {
    nodes,
    image: image.node,
    close,
    sync: image.sync,
    dispose() {
      popups.forEach((popup) => popup.dispose())
      image.dispose()
    },
  }
}
