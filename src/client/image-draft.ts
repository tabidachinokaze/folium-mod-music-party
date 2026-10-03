import { button, el } from './dom'
import { t } from './i18n'
import { mountDetailsPopup } from './popup-position'
import styles from './image-draft.css'

// src/client/image-draft.ts
export function validateImageFile(file: File) {
  if (
    !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) ||
    !file.size ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error(t('请选择 20 MB 以内的 PNG、JPEG、GIF 或 WebP 图片'))
}

export function clipboardImage(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const item of data.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return [...data.files].find((file) => file.type.startsWith('image/')) || null
}

type Selection = { file: File; url: string; context: string }

// A selection is bound to its original chat, including across asynchronous file reads.
export function createImageDraftState(context: () => string | null) {
  let current: Selection | null = null,
    disposed = false
  const clear = () => {
    if (current) URL.revokeObjectURL(current.url)
    current = null
  }
  return {
    select(file: File) {
      if (disposed) return null
      validateImageFile(file)
      const key = context()
      if (!key) return null
      clear()
      current = { file, url: URL.createObjectURL(file), context: key }
      return current
    },
    isCurrent(selection: Selection) {
      return !disposed && current === selection && context() === selection.context
    },
    get current() {
      return current
    },
    clear,
    dispose() {
      clear()
      disposed = true
    },
  }
}

export function createImageDraftPicker(options: {
  draft: HTMLTextAreaElement
  context: () => string | null
  run: (task: () => Promise<unknown>) => Promise<void>
  send: (file: File, isCurrent: () => boolean) => Promise<unknown>
}) {
  const context = () =>
    options.draft.isConnected && options.draft.checkVisibility() ? options.context() : null
  const state = createImageDraftState(context)
  const node = el('details', 'mp-stickers'),
    content = el('div', 'mp-sticker-content mp-image-picker'),
    css = el('style'),
    preview = el('div', 'mp-image-draft-preview'),
    image = el('img'),
    filename = el('p', 'mp-image-draft-name'),
    actions = el('div', 'mp-image-draft-actions'),
    input = el('input')
  css.textContent = styles
  image.alt = t('待发送图片预览')
  input.type = 'file'
  input.accept = 'image/png,image/jpeg,image/gif,image/webp'
  input.hidden = true
  let busy = false,
    ready = false,
    disposed = false
  let epoch = 0,
    fileRequest: { context: string | null; epoch: number } | null = null
  const select = button(t('选择图片'), () => {
    fileRequest = { context: context(), epoch }
    input.click()
  })
  const cancel = button(t('取消'), () => close())
  const send = button(
    t('发送图片'),
    () => {
      const selection = state.current
      if (busy || !ready || !selection || !state.isCurrent(selection)) return
      void options.run(async () => {
        const isCurrent = () => node.open && state.isCurrent(selection)
        if (!isCurrent()) return
        busy = true
        render()
        try {
          await options.send(selection.file, isCurrent)
          if (isCurrent()) close()
        } finally {
          busy = false
          if (!disposed) render()
        }
      })
    },
    'mp-button primary',
  )
  function render() {
    preview.hidden = !state.current
    filename.textContent = state.current?.file.name || ''
    select.textContent = t(state.current ? '更换图片' : '选择图片')
    select.disabled = busy
    send.hidden = !state.current
    send.disabled = busy || !ready
    send.textContent = t(busy ? '正在发送…' : '发送图片')
    content.setAttribute('aria-busy', String(busy))
  }
  function clear() {
    epoch++
    state.clear()
    ready = false
    image.removeAttribute('src')
    render()
  }
  async function choose(file: File) {
    if (busy || options.draft.disabled) return
    const selection = state.select(file)
    if (!selection) return
    ready = false
    image.src = selection.url
    render()
    // Do not wait for the asynchronous details toggle to enter the top layer.
    popup.open()
    try {
      await image.decode()
      if (!state.isCurrent(selection)) return
      ready = true
      render()
      popup.position()
    } catch {
      if (!state.isCurrent(selection)) return
      clear()
      throw new Error(t('无法读取图片'))
    }
  }
  const paste = (event: ClipboardEvent) => {
    if (options.draft.disabled || busy) return
    const file = clipboardImage(event.clipboardData)
    if (!file) return
    event.preventDefault()
    void options.run(() => choose(file))
  }
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    input.value = ''
    const request = fileRequest
    fileRequest = null
    if (request && (request.context !== context() || request.epoch !== epoch)) return
    if (file) void options.run(() => choose(file))
  })
  preview.append(image, filename)
  actions.append(select, cancel, send)
  node.append(el('summary', '', t('图片')))
  content.append(
    css,
    el('h3', '', t('发送图片')),
    el('p', 'mp-muted', t('PNG、JPEG、GIF、WebP · 最大 20 MB')),
    preview,
    actions,
    input,
  )
  node.append(content)
  const popup = mountDetailsPopup(node, content)
  const toggle = () => {
    if (!node.open) clear()
  }
  node.addEventListener('toggle', toggle)
  options.draft.addEventListener('paste', paste)
  function close() {
    popup.close()
    clear()
  }
  render()
  return {
    node,
    close,
    sync() {
      if (state.current && !state.isCurrent(state.current)) close()
    },
    dispose() {
      disposed = true
      state.dispose()
      popup.dispose()
      node.removeEventListener('toggle', toggle)
      options.draft.removeEventListener('paste', paste)
    },
  }
}
