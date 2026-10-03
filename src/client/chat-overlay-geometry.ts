// src/client/chat-overlay-geometry.ts
// The pinned Folia adapter reads bottom-control geometry without changing host DOM.
const selector =
  '[data-toast-card], [data-ponder="player-bar"], [data-player-bottom-obstacle], [style*="bottom:"], [class*="bottom-"]'

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
    attributes.disconnect()
    candidates = Array.from(doc.querySelectorAll<HTMLElement>(selector)).filter((item) => {
      if (item.closest('[data-folium-slot]')) return false
      const style = getComputedStyle(item)
      return (
        item.matches(
          '[data-toast-card], [data-ponder="player-bar"], [data-player-bottom-obstacle]',
        ) ||
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
    const height = window.innerHeight,
      viewportWidth = window.innerWidth,
      left = Math.min(24, Math.max(8, (viewportWidth - 280) / 2)),
      width = Math.min(340, Math.max(0, viewportWidth - left * 2))
    let bottom = 32
    for (const item of candidates) {
      if (!item.isConnected || !item.getClientRects().length) continue
      if (item.matches('[data-ponder="player-bar"]')) {
        let parent: HTMLElement | null = item
        for (let level = 0; parent && level < 5; level++, parent = parent.parentElement) {
          const value = Number.parseFloat(parent.style.bottom)
          if (Number.isFinite(value)) {
            bottom = Math.max(bottom, value)
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
      if (
        rect.width > 0 &&
        (rect.width <= viewportWidth * 0.65 ||
          item.matches(
            '[data-toast-card], [data-ponder="player-bar"], [data-player-bottom-obstacle]',
          )) &&
        rect.height > 0 &&
        rect.height < height * 0.5 &&
        rect.top >= height * 0.4 &&
        rect.bottom <= height + 24 &&
        rect.right > left &&
        rect.left < left + width
      )
        bottom = Math.max(bottom, height - rect.top + 12)
    }
    bottom = Math.min(Math.max(8, height - 160), bottom)
    const values = {
      '--mp-overlay-left': `${Math.round(left)}px`,
      '--mp-overlay-width': `${Math.round(width)}px`,
      '--mp-overlay-bottom': `${Math.round(bottom)}px`,
      '--mp-overlay-height': `${Math.max(0, Math.floor(height - bottom - 24))}px`,
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
