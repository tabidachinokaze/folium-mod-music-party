// src/client/panel-chat-layout.ts
// The native sidebar sizes to content, with its cover and tab row above this
// mount. Cap chat at the remaining space; empty/short histories size to content.
export function mountPanelChatLayout(page: HTMLElement) {
  const ancestors: HTMLElement[] = []
  let node: HTMLElement | null = page
  while (node) {
    ancestors.push(node)
    if (node.matches('[data-testid="unified-panel-surface"]')) break
    const root: Node = node.getRootNode()
    node = node.parentElement || (root instanceof ShadowRoot ? (root.host as HTMLElement) : null)
  }
  const panel = ancestors.at(-1)
  let frame = 0
  const sync = () => {
    if (!panel?.matches('[data-testid="unified-panel-surface"]')) return
    if (!page.classList.contains('mp-chat-layout')) {
      page.style.removeProperty('--mp-chat-panel-max-height')
      return
    }
    if (!panel.offsetHeight || !page.offsetHeight) return
    const style = getComputedStyle(panel),
      maxHeight = Number.parseFloat(style.maxHeight),
      fixedHeight =
        panel.style.height && panel.style.height !== 'auto'
          ? Number.parseFloat(style.height)
          : Infinity,
      limit = Math.min(Number.isFinite(maxHeight) ? maxHeight : Infinity, fixedHeight)
    if (!Number.isFinite(limit)) return
    // Rects include the host's opening scale animation; measurements and CSS
    // heights must remain in the same (untransformed) coordinate system.
    const bounds = panel.getBoundingClientRect(),
      scale = bounds.height / panel.offsetHeight || 1,
      offset = (page.getBoundingClientRect().top - bounds.top) / scale + panel.scrollTop,
      bottomInset = ancestors.slice(1).reduce((total, ancestor) => {
        const css = getComputedStyle(ancestor)
        return (
          total +
          (Number.parseFloat(css.paddingBottom) || 0) +
          (Number.parseFloat(css.borderBottomWidth) || 0)
        )
      }, 0),
      height = Math.max(0, Math.floor(limit - offset - bottomInset))
    const next = `${height}px`
    if (page.style.getPropertyValue('--mp-chat-panel-max-height') !== next)
      page.style.setProperty('--mp-chat-panel-max-height', next)
  }
  const schedule = () => {
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      sync()
    })
  }
  const resize = new ResizeObserver(schedule)
  for (const ancestor of ancestors) resize.observe(ancestor)
  window.addEventListener('resize', schedule)
  return {
    sync: schedule,
    dispose() {
      cancelAnimationFrame(frame)
      resize.disconnect()
      window.removeEventListener('resize', schedule)
    },
  }
}
