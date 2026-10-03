import type { PartyController } from './controller'
import { button, el } from './dom'
import { messageSticker } from './message-sticker'
import { mountPopup } from './popup-position'
import { stickerCollectionChanged } from './sticker-collection'
import { t } from './i18n'
import styles from './sticker-menu.css'

// src/client/sticker-menu.ts
export function mountStickerMenu(history: HTMLElement, controller: PartyController) {
  const css = el('style')
  css.textContent = styles
  const menu = el('div', 'mp-sticker-menu')
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('表情包操作'))
  // A sibling of the history avoids scroll clipping while preserving the surface theme.
  history.after(css, menu)
  let popup: ReturnType<typeof mountPopup> | null = null,
    menuAccount = '',
    anchor: HTMLImageElement | null = null,
    busy = false,
    disposed = false
  const close = () => {
    popup?.dispose()
    popup = null
    anchor = null
  }
  const contextmenu = (event: MouseEvent) => {
    if (disposed || busy || !(event.target instanceof HTMLImageElement)) return
    const image = event.target,
      row = image.closest<HTMLElement>('.mp-message'),
      emoji = messageSticker(image),
      account = controller.state.account?.uid
    if (!emoji || emoji.emojiId === '0' || !account || !row || row.classList.contains('is-mine'))
      return
    event.preventDefault()
    event.stopPropagation()
    close()
    const save = button(t('添加到我的表情包'), () => {
      if (busy || !row.isConnected || account !== controller.state.account?.uid) return
      busy = true
      close()
      void controller.connection
        .attachment('saveSticker', emoji)
        .then(() => {
          if (disposed || account !== controller.state.account?.uid) return
          stickerCollectionChanged(controller)
          controller.notify('已添加到我的表情包', 'success')
        })
        .catch((error) => {
          if (disposed || account !== controller.state.account?.uid) return
          controller.handleAccountError(error)
          controller.notify(error.message || '表情保存失败，请重试', 'error')
        })
        .finally(() => {
          busy = false
        })
    })
    save.setAttribute('role', 'menuitem')
    menu.replaceChildren(save)
    menuAccount = account
    anchor = image
    popup = mountPopup(menu, image, { width: 208, align: 'start' })
    popup.open()
    save.focus()
  }
  const stop = controller.subscribe(() => {
    if (!menu.matches(':popover-open')) return
    // Removed/replaced message nodes must not leave a stale action floating above the view.
    if (controller.state.account?.uid !== menuAccount || !anchor?.isConnected) close()
  })
  history.addEventListener('contextmenu', contextmenu)
  return {
    close,
    dispose() {
      disposed = true
      close()
      stop()
      history.removeEventListener('contextmenu', contextmenu)
      menu.remove()
      css.remove()
    },
  }
}
