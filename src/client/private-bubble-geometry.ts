type Rect = { left: number; top: number; width: number; height: number }
type Obstacle = Rect & { edge?: 'top' }

// Uses the same pinned, read-only host geometry adapter as floating room chat.
// AppShell's no-drag controls remain mounted while faded out. Keep their reveal area clear.
const topSelector = '[data-player-top-obstacle], [style*="app-region: no-drag"]',
  selector = `[data-testid="unified-panel-surface"], [data-ponder="player-bar"], [data-player-bottom-obstacle], [data-toast-card], [data-testid="panel-toggle"], ${topSelector}`

export function privateBubbleLayout(
  stage: Rect,
  obstacles: Obstacle[],
  panelOpen: boolean,
  reserveToast = false,
) {
  const margin = stage.width < 600 ? 12 : 24
  let top = margin,
    right = margin,
    bottom = margin
  const panel = obstacles.find(
    (rect) =>
      rect.edge !== 'top' &&
      rect.height > 240 &&
      rect.width >= 240 &&
      rect.left > stage.left + stage.width / 2,
  )
  if (panelOpen && stage.width >= 850)
    right = panel ? stage.left + stage.width - panel.left + 12 : 368
  const width = Math.min(380, Math.max(0, stage.width - right - margin))
  const left = stage.left + stage.width - right - width
  for (const rect of obstacles) {
    if (rect === panel && panelOpen) continue
    if (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.height < stage.height / 2 &&
      rect.left < left + width &&
      rect.left + rect.width > left
    ) {
      if (
        rect.edge === 'top' &&
        rect.top + rect.height > stage.top &&
        rect.top < stage.top + stage.height / 2
      )
        top = Math.max(top, rect.top + rect.height - stage.top + 12)
      else if (rect.edge !== 'top' && rect.top >= stage.top + stage.height * 0.55)
        bottom = Math.max(bottom, stage.top + stage.height - rect.top + 12)
    }
  }
  top = Math.min(top, Math.max(0, stage.height - 58))
  bottom = Math.min(bottom, Math.max(0, stage.height - top - 66))
  const toastSpace = reserveToast && stage.height >= 520 ? 112 : 0
  const toastTop = top + 66,
    dialogTop = toastTop + toastSpace
  return {
    right,
    bottom,
    width,
    top,
    toastTop,
    toastHeight: Math.max(0, stage.height - bottom - toastTop),
    dialogTop,
    height: Math.max(0, Math.min(494, stage.height - bottom - dialogTop)),
  }
}

export function mountPrivateBubbleGeometry(
  node: HTMLElement,
  panelOpen: () => boolean,
  reserveToast: () => boolean,
) {
  let disposed = false,
    timer: ReturnType<typeof setTimeout> | undefined
  const observed = new Set<Element>()
  const measure = () => {
    if (disposed) return
    const rect = node.getBoundingClientRect()
    const candidates = [...node.ownerDocument.querySelectorAll<HTMLElement>(selector)]
    for (const item of observed)
      if (!candidates.includes(item as HTMLElement)) {
        resize.unobserve(item)
        observed.delete(item)
      }
    const obstacles: Obstacle[] = []
    for (const item of candidates) {
      if (!observed.has(item)) {
        observed.add(item)
        resize.observe(item)
      }
      if (!item.getClientRects().length) continue
      const isTop = item.matches(topSelector)
      if (!isTop && getComputedStyle(item).visibility === 'hidden') continue
      const { left, top, width, height } = item.getBoundingClientRect()
      obstacles.push({ left, top, width, height, ...(isTop ? { edge: 'top' } : {}) })
    }
    const layout = privateBubbleLayout(rect, obstacles, panelOpen(), reserveToast())
    node.dataset.compactDialog = String(rect.height < 520)
    for (const [name, value] of Object.entries(layout))
      node.style.setProperty(
        `--mp-dm-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
        `${value}px`,
      )
  }
  const refresh = () => {
    if (disposed || timer) return
    timer = setTimeout(() => {
      timer = undefined
      measure()
    }, 80)
  }
  const resize = new ResizeObserver(refresh)
  resize.observe(node)
  const changed = new MutationObserver((records) => {
    if (
      records.some((record) =>
        record.type === 'childList'
          ? [...record.addedNodes, ...record.removedNodes].some(
              (item) =>
                item instanceof HTMLElement &&
                (item.matches(selector) || item.querySelector(selector)),
            )
          : record.target instanceof HTMLElement &&
            (record.target.matches(selector) || record.target.querySelector(selector)),
      )
    )
      refresh()
  })
  changed.observe(node.ownerDocument.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden'],
  })
  window.addEventListener('resize', refresh)
  measure()
  return {
    refresh,
    dispose() {
      disposed = true
      clearTimeout(timer)
      resize.disconnect()
      changed.disconnect()
      window.removeEventListener('resize', refresh)
    },
  }
}
