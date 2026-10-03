import { t } from './i18n'

// src/client/popup-position.ts
type PopupOptions = {
  width?: number
  align?: 'start' | 'end'
  maxHeight?: 'viewport'
  placement?: 'contextual' | 'dropdown'
  onClose?: () => void
}
type Bounds = { left: number; right: number; top: number; bottom: number }
type VerticalBounds = Pick<Bounds, 'top' | 'bottom'>
type PopupEntry = {
  popup: HTMLElement
  anchor: HTMLElement
  parent: PopupEntry | null
  close(): void
  isOpen(): boolean
}
const activePopups = new WeakMap<Document, PopupEntry>()

function descendsFrom(entry: PopupEntry | undefined, parent: PopupEntry): boolean {
  for (let current = entry?.parent; current; current = current.parent)
    if (current === parent) return true
  return false
}

export function dropdownPopupPosition(
  anchor: Bounds,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
) {
  const margin = 8,
    gap = 4,
    width = Math.min(size.width, Math.max(0, viewport.width - margin * 2)),
    below = Math.max(0, viewport.height - margin - anchor.bottom - gap),
    above = Math.max(0, anchor.top - margin - gap),
    wantedHeight = Math.min(180, size.height || 180),
    side = below >= wantedHeight || below >= above ? 'below' : 'above',
    maxHeight = Math.min(180, side === 'below' ? below : above),
    height = Math.min(size.height, maxHeight),
    desiredTop = side === 'above' ? anchor.top - gap - height : anchor.bottom + gap
  return {
    width,
    maxHeight,
    side,
    left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)),
    top: Math.max(margin, Math.min(desiredTop, viewport.height - margin - height)),
  }
}

// Match the native sidebar's maximum expanded area, not its current content height.
export function playerPopupBounds(
  viewportHeight: number,
  panel: { bottom: number; maxHeight: number } | null,
  page: VerticalBounds | null = null,
): VerticalBounds {
  const bottom = Math.max(
    8,
    Math.min(viewportHeight - 8, panel?.bottom ?? page?.bottom ?? viewportHeight - 8),
  )
  const desiredTop = panel ? panel.bottom - panel.maxHeight : (page?.top ?? 8)
  return { top: Math.min(bottom, Math.max(8, desiredTop)), bottom }
}

// Message actions belong to the selected image, rather than the outer sidebar.
export function contextualPopupPosition(
  anchor: Bounds,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  collisionBounds?: VerticalBounds,
) {
  const margin = 8,
    gap = 10,
    width = Math.min(size.width, Math.max(0, viewport.width - margin * 2)),
    minTop = Math.max(margin, collisionBounds?.top ?? margin),
    maxBottom = Math.max(
      minTop,
      Math.min(viewport.height - margin, collisionBounds?.bottom ?? viewport.height - margin),
    ),
    maxHeight = Math.max(0, maxBottom - minTop),
    height = Math.min(size.height, maxHeight),
    center = (anchor.left + anchor.right) / 2,
    left = Math.max(margin, Math.min(center - width / 2, viewport.width - width - margin)),
    above = anchor.top - gap - minTop,
    below = maxBottom - anchor.bottom - gap,
    side = above >= height || above >= below ? 'above' : 'below',
    desiredTop = side === 'above' ? anchor.top - gap - height : anchor.bottom + gap,
    arrowInset = Math.min(16, width / 2)
  return {
    width,
    maxHeight,
    left,
    top: Math.max(minTop, Math.min(desiredTop, maxBottom - height)),
    side,
    arrowLeft: Math.max(arrowInset, Math.min(center - left, width - arrowInset)),
  }
}

// Keep geometry independent of DOM so narrow windows and panel padding are testable.
export function popupPosition(
  anchor: Bounds,
  panel: Bounds | null,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  align: 'start' | 'end' = 'end',
  useViewportHeight = false,
  verticalBounds?: VerticalBounds,
  preferredSide: 'left' | 'right' = 'left',
) {
  const margin = 8,
    gap = 12,
    availableWidth = Math.max(0, viewport.width - margin * 2),
    preferredWidth = Math.min(size.width, availableWidth),
    minSideWidth = Math.min(240, preferredWidth)
  let width = preferredWidth,
    left = anchor.left
  const fitsLeft = panel && panel.left - gap - margin >= minSideWidth,
    fitsRight = panel && viewport.width - panel.right - gap - margin >= minSideWidth
  if (panel && fitsRight && (preferredSide === 'right' || !fitsLeft)) {
    width = Math.min(preferredWidth, viewport.width - panel.right - gap - margin)
    left = panel.right + gap
  } else if (panel && fitsLeft) {
    width = Math.min(preferredWidth, panel.left - gap - margin)
    left = panel.left - gap - width
  } else if (panel) left = preferredSide === 'right' ? panel.left : panel.right - width
  const minTop = useViewportHeight ? Math.max(margin, verticalBounds?.top ?? margin) : margin,
    maxBottom = useViewportHeight
      ? Math.min(viewport.height - margin, verticalBounds?.bottom ?? viewport.height - margin)
      : viewport.height - margin,
    maxHeight = Math.max(0, maxBottom - minTop),
    height = useViewportHeight ? Math.min(size.height, maxHeight) : size.height
  const desiredTop = panel
    ? align === 'start'
      ? anchor.top
      : anchor.bottom - height
    : anchor.top - gap - height
  return {
    width,
    left: Math.max(margin, Math.min(left, viewport.width - width - margin)),
    top: Math.max(minTop, Math.min(desiredTop, maxBottom - height)),
    ...(useViewportHeight ? { maxHeight } : {}),
  }
}

function panelFor(anchor: HTMLElement): HTMLElement | null {
  // Floating chat can live in another shadow root; its tools should open beside
  // the whole window instead of falling back to a private-composer placement.
  let branch: HTMLElement | null = anchor
  while (branch) {
    const floating = branch.closest<HTMLElement>('.mp-floating-chat')
    if (floating) return floating
    const root: Node = branch.getRootNode()
    branch = root instanceof ShadowRoot ? (root.host as HTMLElement) : null
  }
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

function playerPanelFor(anchor: HTMLElement, panel: HTMLElement | null) {
  if (!panel?.matches('.mp-floating-chat')) return panel
  // The small floating chat window is not the player's maximum expanded area.
  // Reuse a visible native sidebar's clearance when it exists.
  return (
    [
      ...anchor.ownerDocument.querySelectorAll<HTMLElement>(
        '[data-testid="unified-panel-surface"]',
      ),
    ].find((candidate) => candidate.getBoundingClientRect().height > 0) || null
  )
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

function visibleHistoryBounds(anchor: HTMLElement): VerticalBounds | undefined {
  const history = anchor.closest<HTMLElement>('.mp-history')
  if (!history) return undefined
  const visible = {
    top: history.getBoundingClientRect().top,
    bottom: history.getBoundingClientRect().bottom,
  }
  for (const parent of ancestors(history).slice(1)) {
    // Root/body overflow is propagated to the viewport. Folia's fixed app shell
    // leaves their layout boxes at height zero; they do not clip that shell to
    // an empty rectangle. contextualPopupPosition already clamps the viewport.
    if (parent === anchor.ownerDocument.body || parent === anchor.ownerDocument.documentElement)
      continue
    if (!/(?:auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) continue
    const rect = parent.getBoundingClientRect()
    visible.top = Math.max(visible.top, rect.top)
    visible.bottom = Math.min(visible.bottom, rect.bottom)
  }
  return visible
}

export function mountPopup(popup: HTMLElement, anchor: HTMLElement, options: PopupOptions = {}) {
  popup.popover = 'manual'
  popup.classList.add('mp-floating-popup')
  const doc = anchor.ownerDocument
  let disposed = false,
    registered = false,
    closing = false,
    frame = 0,
    observedAncestors: HTMLElement[] = [],
    root: Node | null = null
  const isOpen = () => popup.matches(':popover-open')
  const entry: PopupEntry = {
    popup,
    anchor,
    parent: null,
    close,
    isOpen: () => !closing && isOpen(),
  }
  function position() {
    if (!isOpen()) return
    if (!anchor.isConnected) {
      close()
      return
    }
    if (options.placement === 'dropdown') {
      const rect = anchor.getBoundingClientRect(),
        parent = entry.parent,
        parentBounds = parent?.popup.getBoundingClientRect(),
        viewport = { width: window.innerWidth, height: window.innerHeight }
      if (
        parent &&
        (!parent.isOpen() ||
          !parent.popup.contains(anchor) ||
          (parentBounds &&
            (rect.bottom <= parentBounds.top ||
              rect.top >= parentBounds.bottom ||
              rect.right <= parentBounds.left ||
              rect.left >= parentBounds.right)))
      ) {
        close()
        return
      }
      const initial = dropdownPopupPosition(rect, viewport, {
        width: options.width ?? 136,
        height: 0,
      })
      popup.style.width = `${initial.width}px`
      popup.style.maxHeight = `${initial.maxHeight}px`
      const placed = dropdownPopupPosition(rect, viewport, {
        width: options.width ?? 136,
        height: popup.getBoundingClientRect().height,
      })
      popup.style.left = `${placed.left}px`
      popup.style.top = `${placed.top}px`
      popup.style.maxHeight = `${placed.maxHeight}px`
      popup.dataset.side = placed.side
      return
    }
    if (options.placement === 'contextual') {
      const rect = anchor.getBoundingClientRect(),
        viewport = { width: window.innerWidth, height: window.innerHeight },
        historyBounds = visibleHistoryBounds(anchor),
        initial = contextualPopupPosition(
          rect,
          viewport,
          {
            width: options.width ?? 208,
            height: 0,
          },
          historyBounds,
        )
      if (historyBounds && (rect.bottom <= historyBounds.top || rect.top >= historyBounds.bottom)) {
        close()
        return
      }
      popup.style.width = `${initial.width}px`
      popup.style.maxHeight = `${initial.maxHeight}px`
      const placed = contextualPopupPosition(
        rect,
        viewport,
        {
          width: options.width ?? 208,
          height: popup.getBoundingClientRect().height,
        },
        historyBounds,
      )
      popup.style.left = `${placed.left}px`
      popup.style.top = `${placed.top}px`
      popup.style.setProperty('--mp-popup-arrow-x', `${placed.arrowLeft}px`)
      popup.dataset.side = placed.side
      return
    }
    const panel = panelFor(anchor),
      panelBounds = panel?.getBoundingClientRect() || null,
      playerPanel = playerPanelFor(anchor, panel),
      playerBounds = playerPanel?.getBoundingClientRect() || null,
      preferredSide = panel?.matches('.mp-floating-chat') ? 'right' : 'left',
      rect = anchor.getBoundingClientRect(),
      viewport = { width: window.innerWidth, height: window.innerHeight },
      nativeMaxHeight = playerPanel
        ? Number.parseFloat(getComputedStyle(playerPanel).maxHeight)
        : NaN,
      verticalBounds =
        options.maxHeight === 'viewport'
          ? playerPopupBounds(
              viewport.height,
              playerBounds && Number.isFinite(nativeMaxHeight) && nativeMaxHeight > 0
                ? { bottom: playerBounds.bottom, maxHeight: nativeMaxHeight }
                : null,
              anchor.closest<HTMLElement>('.mp-private-home')?.getBoundingClientRect() || null,
            )
          : undefined,
      initial = popupPosition(
        rect,
        panelBounds,
        viewport,
        {
          width: options.width ?? 320,
          height: 0,
        },
        options.align,
        options.maxHeight === 'viewport',
        verticalBounds,
        preferredSide,
      )
    popup.style.width = `${initial.width}px`
    // Apply the limit before measuring: additional sticker pages may grow the
    // popup naturally, preserving the player/sidebar's vertical clearance.
    if (initial.maxHeight !== undefined) popup.style.maxHeight = `${initial.maxHeight}px`
    const placed = popupPosition(
      rect,
      panelBounds,
      viewport,
      {
        width: options.width ?? 320,
        height: popup.getBoundingClientRect().height,
      },
      options.align,
      options.maxHeight === 'viewport',
      verticalBounds,
      preferredSide,
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
    if (closing) return
    closing = true
    cancelAnimationFrame(frame)
    frame = 0
    let active = activePopups.get(doc)
    while (active && descendsFrom(active, entry)) {
      active.close()
      const next = activePopups.get(doc)
      if (next === active) break
      active = next
    }
    const wasOpen = registered || isOpen()
    if (isOpen()) popup.hidePopover()
    visibility.disconnect()
    if (activePopups.get(doc) === entry) {
      let parent = entry.parent
      while (parent && !parent.isOpen()) parent = parent.parent
      if (parent) activePopups.set(doc, parent)
      else activePopups.delete(doc)
    }
    registered = false
    entry.parent = null
    anchor.setAttribute('aria-expanded', 'false')
    closing = false
    if (wasOpen) options.onClose?.()
  }
  const outside = (event: Event) => {
    if (!registered && !isOpen()) return
    const path = event.composedPath()
    if (path.includes(popup) || path.includes(anchor)) return
    for (
      let child = activePopups.get(doc);
      child && descendsFrom(child, entry);
      child = child.parent ?? undefined
    )
      if (path.includes(child.popup) || path.includes(child.anchor)) return
    close()
  }
  const escape = (event: KeyboardEvent) => {
    if (
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      activePopups.get(doc) === entry &&
      isOpen()
    ) {
      event.preventDefault()
      // Folia's window shortcut also handles Escape; dismiss this popup only.
      event.stopPropagation()
      close()
      anchor.focus()
    }
  }
  const resize = new ResizeObserver(schedule)
  resize.observe(popup)
  resize.observe(anchor)
  const visibility = new MutationObserver(() => {
    if (observedAncestors.some((parent) => parent.hidden)) close()
    else schedule()
  })
  const toggled = () => {
    // Host/page teardown can call hidePopover directly; still release the
    // active chain, descendant menus, observers and the trigger's open state.
    if (registered && !isOpen()) close()
  }
  popup.addEventListener('toggle', toggled)
  doc.addEventListener('pointerdown', outside)
  doc.addEventListener('keydown', escape)
  doc.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  return {
    position,
    close,
    open() {
      if (registered && isOpen()) {
        position()
        schedule()
        return
      }
      observedAncestors = ancestors(anchor)
      if (disposed || observedAncestors.some((parent) => parent.hidden) || !popup.isConnected)
        return
      visibility.disconnect()
      for (const parent of observedAncestors)
        visibility.observe(parent, {
          attributes: true,
          attributeFilter: ['hidden', 'style', 'class'],
        })
      const attachedRoot = anchor.getRootNode()
      if (root !== attachedRoot) {
        root?.removeEventListener('scroll', schedule, true)
        root = attachedRoot
        if (root !== doc) root.addEventListener('scroll', schedule, true)
      }
      const panel = panelFor(anchor)
      if (panel) resize.observe(panel)
      let previous = activePopups.get(doc)
      while (
        previous &&
        previous !== entry &&
        (!previous.isOpen() || !previous.popup.contains(anchor))
      ) {
        previous.close()
        const next = activePopups.get(doc)
        if (next === previous) break
        previous = next
      }
      if (previous !== entry) entry.parent = previous || null
      activePopups.set(doc, entry)
      registered = true
      try {
        popup.showPopover()
      } catch (error) {
        close()
        throw error
      }
      anchor.setAttribute('aria-expanded', 'true')
      position()
      // Opening a details-backed popover can precede its expanded layout.
      // A quick same-size reopen may not trigger ResizeObserver again.
      schedule()
    },
    dispose() {
      close()
      disposed = true
      cancelAnimationFrame(frame)
      resize.disconnect()
      visibility.disconnect()
      popup.removeEventListener('toggle', toggled)
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
    open() {
      box.open = true
      popup.open()
    },
    position: popup.position,
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
