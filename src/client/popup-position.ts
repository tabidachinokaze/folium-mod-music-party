import { t } from './i18n'

// src/client/popup-position.ts
type PopupOptions = {
  width?: number
  align?: 'start' | 'end'
  constrainHeightToPanel?: boolean
  onClose?: () => void
}
type Bounds = { left: number; right: number; top: number; bottom: number }
const activePopups = new WeakMap<Document, () => void>()

// Keep geometry independent of DOM so narrow windows and panel padding are testable.
export function popupPosition(
  anchor: Bounds,
  panel: Bounds | null,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  align: 'start' | 'end' = 'end',
  constrainHeightToPanel = false,
) {
  const margin = 8,
    gap = 12,
    availableWidth = Math.max(0, viewport.width - margin * 2),
    preferredWidth = Math.min(size.width, availableWidth),
    minSideWidth = Math.min(240, preferredWidth)
  let width = preferredWidth,
    left = anchor.left
  if (panel && panel.left - gap - margin >= minSideWidth) {
    width = Math.min(preferredWidth, panel.left - gap - margin)
    left = panel.left - gap - width
  } else if (panel && viewport.width - panel.right - gap - margin >= minSideWidth) {
    width = Math.min(preferredWidth, viewport.width - panel.right - gap - margin)
    left = panel.right + gap
  } else if (panel) left = panel.right - width
  const bounded = constrainHeightToPanel && panel !== null,
    minTop = bounded ? Math.max(margin, panel.top) : margin,
    maxBottom = bounded
      ? Math.min(viewport.height - margin, panel.bottom)
      : viewport.height - margin,
    maxHeight = Math.max(0, maxBottom - minTop),
    height = bounded ? Math.min(size.height, maxHeight) : size.height
  const desiredTop = panel
    ? align === 'start'
      ? anchor.top
      : anchor.bottom - height
    : anchor.top - gap - height
  return {
    width,
    left: Math.max(margin, Math.min(left, viewport.width - width - margin)),
    top: Math.max(minTop, Math.min(desiredTop, maxBottom - height)),
    ...(bounded ? { maxHeight } : {}),
  }
}

function panelFor(anchor: HTMLElement): HTMLElement | null {
  const panel = anchor.closest<HTMLElement>('.mp-panel')
  if (!panel) return null
  // Folia isolates the mount twice. Use the outer panel bounds, including its
  // padding, rather than anchoring to the narrow button inside the plugin.
  let parent: HTMLElement | null = panel
  while (parent) {
    if (parent.matches('[data-testid="unified-panel-surface"]')) return parent
    const root: Node = parent.getRootNode()
    parent =
      parent.parentElement || (root instanceof ShadowRoot ? (root.host as HTMLElement) : null)
  }
  return panel
}

function ancestors(element: HTMLElement) {
  const result: HTMLElement[] = []
  let parent: HTMLElement | null = element
  while (parent) {
    result.push(parent)
    const root: Node = parent.getRootNode()
    parent =
      parent.parentElement || (root instanceof ShadowRoot ? (root.host as HTMLElement) : null)
  }
  return result
}

export function mountPopup(popup: HTMLElement, anchor: HTMLElement, options: PopupOptions = {}) {
  popup.popover = 'manual'
  popup.classList.add('mp-floating-popup')
  const doc = anchor.ownerDocument
  let disposed = false,
    frame = 0,
    observedAncestors: HTMLElement[] = [],
    root: Node | null = null
  const isOpen = () => popup.matches(':popover-open')
  function position() {
    if (!isOpen()) return
    const panel = panelFor(anchor),
      panelBounds = panel?.getBoundingClientRect() || null,
      rect = anchor.getBoundingClientRect(),
      viewport = { width: window.innerWidth, height: window.innerHeight },
      initial = popupPosition(
        rect,
        panelBounds,
        viewport,
        {
          width: options.width ?? 320,
          height: 0,
        },
        options.align,
        options.constrainHeightToPanel,
      )
    popup.style.width = `${initial.width}px`
    // Apply the limit before measuring: additional sticker pages may grow the
    // popup naturally, while its border box stays inside the visible panel.
    if (initial.maxHeight !== undefined) popup.style.maxHeight = `${initial.maxHeight}px`
    else if (options.constrainHeightToPanel) popup.style.removeProperty('max-height')
    const placed = popupPosition(
      rect,
      panelBounds,
      viewport,
      {
        width: options.width ?? 320,
        height: popup.getBoundingClientRect().height,
      },
      options.align,
      options.constrainHeightToPanel,
    )
    popup.style.left = `${placed.left}px`
    popup.style.top = `${placed.top}px`
  }
  const schedule = () => {
    if (!isOpen() || frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      position()
    })
  }
  function close() {
    if (!isOpen()) return
    popup.hidePopover()
    visibility.disconnect()
    if (activePopups.get(doc) === close) activePopups.delete(doc)
    anchor.setAttribute('aria-expanded', 'false')
    options.onClose?.()
  }
  const outside = (event: Event) => {
    const path = event.composedPath()
    if (!path.includes(popup) && !path.includes(anchor)) close()
  }
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault()
      close()
      anchor.focus()
    }
  }
  const resize = new ResizeObserver(schedule)
  resize.observe(popup)
  resize.observe(anchor)
  const visibility = new MutationObserver(() => {
    if (observedAncestors.some((parent) => parent.hidden)) close()
  })
  doc.addEventListener('pointerdown', outside)
  doc.addEventListener('keydown', escape)
  doc.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  return {
    position,
    close,
    open() {
      observedAncestors = ancestors(anchor)
      if (disposed || observedAncestors.some((parent) => parent.hidden) || !popup.isConnected)
        return
      visibility.disconnect()
      for (const parent of observedAncestors)
        visibility.observe(parent, { attributes: true, attributeFilter: ['hidden'] })
      const attachedRoot = anchor.getRootNode()
      if (root !== attachedRoot) {
        root?.removeEventListener('scroll', schedule, true)
        root = attachedRoot
        if (root !== doc) root.addEventListener('scroll', schedule, true)
      }
      const panel = panelFor(anchor)
      if (panel) resize.observe(panel)
      const previous = activePopups.get(doc)
      if (previous && previous !== close) previous()
      activePopups.set(doc, close)
      popup.showPopover()
      anchor.setAttribute('aria-expanded', 'true')
      position()
    },
    dispose() {
      close()
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      visibility.disconnect()
      doc.removeEventListener('pointerdown', outside)
      doc.removeEventListener('keydown', escape)
      doc.removeEventListener('scroll', schedule, true)
      if (root !== doc) root?.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    },
  }
}

// Preserve the public details.open contract used by both room and private chat.
export function mountDetailsPopup(
  box: HTMLDetailsElement,
  content: HTMLElement,
  options: Omit<PopupOptions, 'onClose'> = {},
) {
  const summary = box.querySelector('summary')!
  summary.setAttribute('aria-haspopup', 'dialog')
  summary.setAttribute('aria-expanded', 'false')
  content.setAttribute('role', 'dialog')
  content.setAttribute('aria-label', summary.textContent || t('选择内容'))
  const popup = mountPopup(content, summary, {
    ...options,
    onClose: () => {
      box.open = false
    },
  })
  const toggle = () => {
    if (box.open) popup.open()
    else popup.close()
  }
  const click = (event: Event) => {
    event.preventDefault()
    box.open = !box.open
    toggle()
  }
  summary.addEventListener('click', click)
  box.addEventListener('toggle', toggle)
  return {
    close() {
      box.open = false
      popup.close()
    },
    dispose() {
      popup.dispose()
      box.removeEventListener('toggle', toggle)
      summary.removeEventListener('click', click)
    },
  }
}
