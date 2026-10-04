import type { MessageAttachment } from '@party/shared/types'
import { button, el, picture } from './dom'
import { t } from './i18n'

// src/client/private-song-choice.ts
export type PrivateSongChoice = 'audition' | 'recommend'
export type ChoosePrivateSong = (
  item: MessageAttachment,
  signal: AbortSignal,
) => Promise<PrivateSongChoice | null>

let nextChoiceId = 0

/** A native modal retains focus inside the choices and closes without an implicit song action. */
export function createPrivateSongChoice(container: HTMLElement) {
  const dialog = el('dialog', 'mp-private-song-choice'),
    heading = el('h3', '', t('歌曲操作')),
    header = el('header', 'mp-private-song-choice-header'),
    preview = el('div', 'mp-private-song-choice-preview'),
    options = el('div', 'mp-private-song-choice-options'),
    hint = el('p', 'mp-private-song-choice-hint', t('试听仅在本机播放，房间继续一起听。'))
  let finish: ((choice: PrivateSongChoice | null) => void) | null = null,
    disposed = false
  heading.id = `mp-private-song-choice-${++nextChoiceId}`
  hint.id = `${heading.id}-hint`
  dialog.setAttribute('aria-labelledby', heading.id)
  dialog.setAttribute('aria-describedby', hint.id)
  const cancel = button(t('取消'), () => finish?.(null)),
    audition = button(t('试听'), () => finish?.('audition')),
    recommend = button(t('推歌'), () => finish?.('recommend'), 'primary')
  header.append(heading, cancel)
  options.append(audition, recommend)
  dialog.append(header, preview, hint, options)
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    finish?.(null)
  })
  dialog.addEventListener('close', () => {
    // A queued close event from a superseded choice must not cancel its replacement.
    if (!dialog.open) finish?.(null)
  })
  // Keep host playback shortcuts out of an active choice dialog.
  dialog.addEventListener('keydown', (event) => event.stopPropagation())
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      finish?.(null)
  })
  container.append(dialog)
  const choose: ChoosePrivateSong = (item, signal) => {
    finish?.(null)
    if (disposed || signal.aborted || !dialog.isConnected) return Promise.resolve(null)
    preview.replaceChildren()
    const artwork = el('span', 'mp-private-song-choice-cover', '♪'),
      info = el('div', 'mp-private-song-choice-info')
    artwork.setAttribute('aria-hidden', 'true')
    if (item.cover) artwork.append(picture(item.cover))
    info.append(el('strong', '', item.title))
    if (item.artist) info.append(el('span', '', item.artist))
    preview.append(artwork, info)
    return new Promise((resolve, reject) => {
      const abort = () => finish?.(null)
      const complete = (choice: PrivateSongChoice | null) => {
        if (finish !== complete) return
        finish = null
        signal.removeEventListener('abort', abort)
        if (dialog.open) dialog.close()
        resolve(signal.aborted ? null : choice)
      }
      finish = complete
      signal.addEventListener('abort', abort, { once: true })
      try {
        dialog.showModal()
        audition.focus()
      } catch (error) {
        finish = null
        signal.removeEventListener('abort', abort)
        reject(error)
      }
    })
  }
  return {
    choose,
    close() {
      finish?.(null)
    },
    dispose() {
      disposed = true
      finish?.(null)
      dialog.remove()
    },
  }
}
