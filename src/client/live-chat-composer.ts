import { button, el } from './dom'
import { t } from './i18n'

// src/client/live-chat-composer.ts
// Collapse only the floating chat editor; the same textarea and upload tools stay mounted.
export function mountLiveChatComposer(options: {
  container: HTMLElement
  composer: HTMLFormElement
  draft: HTMLTextAreaElement
  emoji: HTMLDetailsElement
  icon: Promise<SVGSVGElement | null>
  closeTools(): void
  onEditorIdle(): void
}) {
  const { container, composer, draft, emoji, closeTools } = options,
    launcher = el('div', 'mp-live-compose-launcher'),
    open = button(t('说点什么…'), () => expand(), 'mp-live-compose-open'),
    emojiButton = button(
      '☺',
      () => {
        expand()
        emoji.querySelector('summary')?.click()
      },
      'mp-live-compose-emoji',
    ),
    close = button('⌄', () => collapse(true), 'mp-live-compose-collapse'),
    events = new AbortController()
  let enabled = false,
    expanded = false,
    composing = false,
    compositionSettling = false,
    collapseAfterComposition = false,
    idleTimer = 0
  open.setAttribute('aria-label', t('说点什么…'))
  emojiButton.setAttribute('aria-label', t('Emoji'))
  emojiButton.title = t('Emoji')
  void options.icon
    .then((icon) => {
      if (icon && !events.signal.aborted) {
        icon.setAttribute('aria-hidden', 'true')
        emojiButton.replaceChildren(icon)
      }
    })
    .catch(() => {})
  close.setAttribute('aria-label', t('收起聊天输入'))
  close.title = t('收起聊天输入')
  launcher.append(open, emojiButton)
  container.insertBefore(launcher, composer)
  composer.append(close)
  function sync() {
    launcher.hidden = !enabled || expanded
    composer.hidden = enabled && !expanded
    close.hidden = !enabled || !expanded
    container.dataset.liveComposer = enabled ? (expanded ? 'expanded' : 'collapsed') : 'off'
    open.textContent = draft.value.trim().replace(/\s+/g, ' ') || t('说点什么…')
    open.classList.toggle('has-draft', !!draft.value.trim())
    open.setAttribute('aria-expanded', String(expanded))
  }
  function expand() {
    if (!enabled || draft.disabled || events.signal.aborted) return
    expanded = true
    sync()
    draft.focus({ preventScroll: true })
  }
  function collapse(focusLauncher = false) {
    if (!enabled || !expanded || events.signal.aborted) return
    if (composing || compositionSettling) {
      collapseAfterComposition = true
      return
    }
    expanded = false
    closeTools()
    const root = composer.getRootNode(),
      active = root instanceof ShadowRoot || root instanceof Document ? root.activeElement : null
    if (active instanceof HTMLElement && composer.contains(active)) active.blur()
    sync()
    if (focusLauncher) open.focus({ preventScroll: true })
  }
  const outside = (event: PointerEvent) => {
    if (!enabled || !expanded) return
    const path = event.composedPath()
    if (!path.includes(composer) && !path.includes(launcher)) collapse()
  }
  container.ownerDocument.addEventListener('pointerdown', outside, {
    capture: true,
    signal: events.signal,
  })
  draft.addEventListener('input', sync, { signal: events.signal })
  draft.addEventListener(
    'compositionstart',
    () => {
      composing = true
      compositionSettling = false
      clearTimeout(idleTimer)
    },
    { signal: events.signal },
  )
  draft.addEventListener(
    'compositionend',
    () => {
      composing = false
      compositionSettling = true
      // The final input event can follow compositionend. Keep the editor alive
      // until that commit has landed before a pending locale change rebuilds it.
      clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => {
        compositionSettling = false
        if (collapseAfterComposition) {
          collapseAfterComposition = false
          collapse()
        }
        options.onEditorIdle()
      }, 0)
    },
    { signal: events.signal },
  )
  draft.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        composing ||
        !enabled ||
        !expanded
      )
        return
      if (composer.querySelector(':popover-open')) return
      event.preventDefault()
      event.stopPropagation()
      collapse(true)
    },
    { signal: events.signal },
  )
  sync()
  return {
    expand,
    isComposing: () => composing || compositionSettling,
    getState() {
      const root = draft.getRootNode()
      return {
        enabled,
        expanded,
        focused:
          (root instanceof ShadowRoot || root instanceof Document) && root.activeElement === draft,
      }
    },
    restoreState(state: { enabled: boolean; expanded: boolean; focused: boolean }) {
      enabled = state.enabled
      expanded = state.expanded
      collapseAfterComposition = false
      sync()
      if (enabled && expanded && state.focused) draft.focus({ preventScroll: true })
    },
    setEnabled(value: boolean) {
      if (enabled === value) return
      enabled = value
      expanded = false
      collapseAfterComposition = false
      sync()
    },
    collapse,
    complete() {
      collapse()
      sync()
    },
    sync,
    dispose() {
      events.abort()
      clearTimeout(idleTimer)
      launcher.remove()
      close.remove()
      composer.hidden = false
      delete container.dataset.liveComposer
    },
  }
}
