// src/client/chat-overlay-geometry.ts
// The pinned Folia adapter reads control geometry without changing host DOM.
// VisualizerShell's back button has no data marker; its placement and icon are stable.
const topSelector = '[data-player-top-obstacle], button.top-6.left-6:has(svg.lucide-chevron-left)',
  selector = `[data-toast-card], [data-ponder="player-bar"], [data-player-bottom-obstacle], [style*="bottom:"], [class*="bottom-"], ${topSelector}`

type Bounds = { left: number; top: number; width: number; height: number }
type Obstacle = Bounds & { allowWide?: boolean; edge?: 'top' | 'bottom' }

export function chatOverlayLayout(stage: Bounds, obstacles: Obstacle[], bottomInset = 32) {
  const left = Math.min(24, Math.max(8, (stage.width - 280) / 2)),
    width = Math.min(340, Math.max(0, stage.width - left * 2))
  let bottom = Math.max(32, bottomInset),
    topMargin = 24
  for (const item of obstacles) {
    const top = item.top - stage.top,
      right = item.left + item.width - stage.left,
      itemLeft = item.left - stage.left
    if (
      item.width > 0 &&
      (item.width <= stage.width * 0.65 || item.allowWide) &&
      item.height > 0 &&
      item.height < stage.height * 0.5 &&
      top + item.height <= stage.height + 24 &&
      right > left &&
      itemLeft < left + width
    ) {
      if (item.edge === 'top' && top >= -24 && top + item.height <= stage.height * 0.5)
        topMargin = Math.max(topMargin, top + item.height + 12)
      else if (item.edge !== 'top' && top >= stage.height * 0.4)
        bottom = Math.max(bottom, stage.height - top + 12)
    }
  }
  bottom = Math.min(Math.max(0, stage.height - topMargin), bottom)
  return {
    left: Math.round(left),
    width: Math.round(width),
    bottom: Math.round(bottom),
    height: Math.max(0, Math.floor(stage.height - bottom - topMargin)),
  }
}

export function mountChatOverlayGeometry(node: HTMLElement) {
  const doc = node.ownerDocument
  let disposed = false,
    timer = 0,
    frame = 0,
    discoverAgain = true,
    candidates: HTMLElement[] = []
  const resize = new ResizeObserver(() => schedule())
  const attributes = new MutationObserver(() => schedule())
  function discover() {
    resize.disconnect()
    resize.observe(node)
    attributes.disconnect()
    candidates = Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter((item) => {
      if (item.closest('[data-folium-slot]')) return false
      const style = getComputedStyle(item)
      return (
        item.matches(
          '[data-toast-card], [data-ponder="player-bar"], [data-player-bottom-obstacle]',
        ) ||
        item.matches(topSelector) ||
        style.position === 'fixed' ||
        (style.position === 'absolute' && style.bottom !== 'auto')
      )
    })
    const observed = new Set<HTMLElement>()
    for (const item of candidates) {
      resize.observe(item)
      let parent: HTMLElement | null = item
      // Position and presence animations live on the control's immediate wrappers.
      for (let level = 0; parent && level < 4; level++, parent = parent.parentElement) {
        if (observed.has(parent)) continue
        observed.add(parent)
        attributes.observe(parent, {
          attributes: true,
          attributeFilter: ['style', 'class', 'hidden'],
        })
      }
    }
  }
  function measure() {
    if (disposed) return
    if (discoverAgain) {
      discoverAgain = false
      discover()
    }
    const stage = node.getBoundingClientRect(),
      obstacles: Obstacle[] = []
    let bottomInset = 32
    for (const item of candidates) {
      if (!item.isConnected || !item.getClientRects().length) continue
      if (item.matches('[data-ponder="player-bar"]')) {
        let parent: HTMLElement | null = item
        for (let level = 0; parent && level < 5; level++, parent = parent.parentElement) {
          const value = Number.parseFloat(parent.style.bottom)
          if (Number.isFinite(value)) {
            bottomInset = Math.max(bottomInset, value)
            break
          }
        }
      }
      let visible = true,
        parent: HTMLElement | null = item
      for (let level = 0; parent && level < 4; level++, parent = parent.parentElement) {
        const style = getComputedStyle(parent)
        if (parent.hidden || style.visibility === 'hidden' || Number(style.opacity) < 0.05) {
          visible = false
          break
        }
      }
      if (!visible) continue
      const rect = item.getBoundingClientRect()
      obstacles.push({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        edge: item.matches(topSelector) ? 'top' : 'bottom',
        allowWide: item.matches(
          '[data-toast-card], [data-ponder="player-bar"], [data-player-bottom-obstacle]',
        ),
      })
    }
    const layout = chatOverlayLayout(stage, obstacles, bottomInset)
    const values = {
      '--mp-overlay-left': `${layout.left}px`,
      '--mp-overlay-width': `${layout.width}px`,
      '--mp-overlay-bottom': `${layout.bottom}px`,
      '--mp-overlay-height': `${layout.height}px`,
    }
    for (const [key, value] of Object.entries(values))
      if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value)
  }
  function schedule(discover = false) {
    discoverAgain ||= discover
    if (disposed || timer || frame) return
    // Geometry follows animated host controls at a bounded rate, never a permanent frame loop.
    timer = window.setTimeout(() => {
      timer = 0
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }, 80)
  }
  const changed = new MutationObserver((records) => {
    if (
      records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some(
          (child) =>
            child instanceof HTMLElement &&
            (child.matches(selector) || child.querySelector(selector)),
        ),
      )
    )
      schedule(true)
  })
  changed.observe(doc.body, { childList: true, subtree: true })
  const resized = () => schedule(true)
  window.addEventListener('resize', resized)
  measure()
  return () => {
    disposed = true
    clearTimeout(timer)
    cancelAnimationFrame(frame)
    resize.disconnect()
    attributes.disconnect()
    changed.disconnect()
    window.removeEventListener('resize', resized)
  }
}
