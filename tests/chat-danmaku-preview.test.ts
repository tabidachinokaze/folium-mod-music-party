import { afterEach, expect, it, vi } from 'vitest'
import type { PartyController } from '../src/client/controller'
import { mountDanmaku } from '../src/client/chat-danmaku'
import { danmakuDefaults } from '../src/client/chat-preferences'
import { danmakuPreviewImage } from '../src/client/chat-danmaku-preview'
import * as previewSamples from '../src/client/chat-danmaku-preview'

const engines = vi.hoisted(() => ({ created: vi.fn(), destroyed: vi.fn() }))
vi.mock('danmaku/dist/esm/danmaku.dom.js', () => ({
  default: class {
    speed: number
    constructor(
      private options: {
        container: Element
        media: { currentTime: number }
        speed: number
      },
    ) {
      this.speed = options.speed
      engines.created(this)
    }
    emit(comment: { render(): Element; mode: string }) {
      const row = comment.render(),
        measuredWidth = row.width
      row.measureLeft = () =>
        comment.mode === 'rtl'
          ? 1100 - ((1100 + measuredWidth) * this.options.media.currentTime) / (1100 / this.speed)
          : (1100 - measuredWidth) / 2
      this.options.container.append(row)
    }
    resize() {}
    destroy() {
      engines.destroyed(this)
    }
  },
}))

class Element extends EventTarget {
  className = ''
  dataset: Record<string, string> = {}
  style = { setProperty: vi.fn(), left: '' }
  children: Element[] = []
  parent: Element | null = null
  shadowRoot: Element | null = null
  src = ''
  textContent = ''
  width = 240
  measureLeft?: () => number
  append(...nodes: Element[]) {
    for (const node of nodes) {
      node.remove()
      node.parent = this
      this.children.push(node)
    }
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this)
    this.parent = null
  }
  attachShadow() {
    return (this.shadowRoot = new Element())
  }
  getBoundingClientRect() {
    return {
      left: this.measureLeft?.() ?? (Number.parseFloat(this.style.left) || 0),
      width: this.dataset.messageId ? this.width : 1100,
      height: 800,
    }
  }
  setAttribute() {}
}
function descendants(node: Element): Element[] {
  return [
    node,
    ...node.children.flatMap(descendants),
    ...(node.shadowRoot ? descendants(node.shadowRoot) : []),
  ]
}
function environment() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  engines.created.mockClear()
  engines.destroyed.mockClear()
  const doc = Object.assign(new EventTarget(), {
      createElement: () => new Element(),
      documentElement: { lang: 'zh-CN' },
      hidden: false,
    }),
    media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('document', doc)
  vi.stubGlobal('matchMedia', () => media)
  for (const name of ['MutationObserver', 'ResizeObserver'])
    vi.stubGlobal(
      name,
      class {
        observe() {}
        disconnect() {}
      },
    )
  const container = new Element(),
    subscribe = vi.fn(),
    controller = {
      subscribe,
      get state() {
        throw new Error('A settings preview must never read room or account state')
      },
    } as unknown as PartyController,
    preview = mountDanmaku(container as unknown as HTMLElement, controller, { preview: true })
  return {
    preview,
    container,
    subscribe,
    doc,
    rows: () => descendants(container).filter((node) => node.dataset.messageId),
  }
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it.each(['scroll', 'top', 'bottom'] as const)(
  'preserves complete preview senders outside shrinkable text in %s mode without duplicating activity actors',
  (mode) => {
    const nickname = 'tabidachinokaze_音楽🎵',
      samples = previewSamples.danmakuPreviewMessages(1)
    vi.spyOn(previewSamples, 'danmakuPreviewMessages').mockImplementation((batch) =>
      samples.map((sample) => ({
        ...sample,
        id: `${sample.id}-${batch}`,
        nickname,
        text: sample.kind === 'resource' ? `${nickname}推荐了歌曲：《海边》` : sample.text,
      })),
    )
    const view = environment()
    view.preview.setOptions({ ...danmakuDefaults, danmakuMode: mode })
    view.preview.setEnabled(true)
    expect(view.rows()).toHaveLength(3)
    for (const row of view.rows()) {
      const author = row.children.find((child) => child.className === 'mp-danmaku-author')!
      expect(author.textContent).toBe(nickname + (row.dataset.kind === 'activity' ? '' : ':'))
      expect(
        row.children
          .map((child) => child.textContent)
          .join('')
          .split(nickname),
      ).toHaveLength(2)
      expect(row.parent?.dataset.mode).toBe(mode)
    }
    const activity = view.rows().find((row) => row.dataset.kind === 'activity')!
    expect(activity.children.map((child) => child.textContent).join('')).toBe(
      `预览${nickname}推荐了歌曲：《海边》`,
    )
    view.preview.dispose()
  },
)

it('previews local samples without subscribing to room data and clears all work when closed', () => {
  const view = environment()
  expect(view.rows()).toHaveLength(0)
  view.preview.setEnabled(true)
  expect(view.rows()).toHaveLength(3)
  expect(view.rows().every((row) => row.dataset.preview === 'true')).toBe(true)
  expect(
    view
      .rows()
      .flatMap(descendants)
      .filter((node) => node.src)
      .map((node) => node.src),
  ).toEqual([danmakuPreviewImage])
  expect(view.subscribe).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(3)
  view.preview.setEnabled(false)
  expect(view.rows()).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
  vi.advanceTimersByTime(60000)
  expect(view.rows()).toHaveLength(0)
  view.preview.dispose()
  expect(view.container.children).toHaveLength(0)
  expect(engines.destroyed).toHaveBeenCalledTimes(engines.created.mock.calls.length)
})

it('honours content filters and visibility while continuously repeating enabled samples', () => {
  const view = environment()
  view.preview.setEnabled(true)
  view.preview.setOptions({
    ...danmakuDefaults,
    danmakuMode: 'bottom',
    danmakuText: false,
    danmakuMedia: false,
  })
  expect(view.rows().map((row) => row.dataset.kind)).toEqual(['activity'])
  view.preview.setVisible(false)
  expect(view.rows()).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
  view.preview.setVisible(true)
  expect(view.rows()).toHaveLength(1)
  view.preview.setOptions({
    ...danmakuDefaults,
    danmakuText: false,
    danmakuMedia: false,
    danmakuActivity: false,
  })
  expect(view.rows()).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
  view.preview.setOptions(danmakuDefaults)
  const ids = view.rows().map((row) => row.dataset.messageId)
  vi.advanceTimersByTime(9041)
  expect(view.rows()).toHaveLength(3)
  expect(vi.getTimerCount()).toBe(3)
  expect(view.rows().every((row) => !ids.includes(row.dataset.messageId))).toBe(true)
  const secondIds = view.rows().map((row) => row.dataset.messageId)
  vi.advanceTimersByTime(9041)
  expect(view.rows()).toHaveLength(3)
  expect(vi.getTimerCount()).toBe(3)
  expect(view.rows().every((row) => !secondIds.includes(row.dataset.messageId))).toBe(true)
  view.doc.hidden = true
  view.doc.dispatchEvent(new Event('visibilitychange'))
  expect(view.rows()).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(0)
  view.doc.hidden = false
  view.doc.dispatchEvent(new Event('visibilitychange'))
  expect(view.rows()).toHaveLength(3)
  view.preview.dispose()
  expect(vi.getTimerCount()).toBe(0)
  expect(engines.destroyed).toHaveBeenCalledTimes(engines.created.mock.calls.length)
})

it('keeps the same hovered row and horizontal position while applying styles, sizes and speeds', () => {
  const view = environment()
  view.preview.setEnabled(true)
  vi.advanceTimersByTime(2000)
  const row = view.rows().find((node) => node.dataset.kind === 'text')!,
    initial = row.getBoundingClientRect().left,
    initialEngine = engines.created.mock.calls[0][0]
  row.dispatchEvent(new Event('pointerenter'))
  row.width = 360 // The browser measures this new width after the font-size change.
  const changed = {
    ...danmakuDefaults,
    danmakuOpacity: 45,
    danmakuHoverOpacity: 67,
    danmakuFontSize: 150,
    danmakuSpeed: 150,
    danmakuArea: 40,
  }
  view.preview.setOptions(changed)
  expect(view.rows()).toContain(row)
  expect(row.dataset.paused).toBe('true')
  expect(row.getBoundingClientRect().left).toBeCloseTo(initial)
  expect(engines.destroyed).not.toHaveBeenCalledWith(initialEngine)
  const stage = descendants(view.container).find((node) => node.className === 'mp-danmaku')!
  expect(stage.style.setProperty).toHaveBeenCalledWith('--mp-danmaku-hover-opacity', '0.67')
  vi.advanceTimersByTime(20000)
  expect(view.rows()).toContain(row)
  expect(row.getBoundingClientRect().left).toBeCloseTo(initial)
  row.dispatchEvent(new Event('pointerleave'))
  expect(row.dataset.paused).toBe('false')
  expect(engines.destroyed).toHaveBeenCalledWith(initialEngine)
  expect(row.getBoundingClientRect().left).toBeCloseTo(initial)
  vi.advanceTimersByTime(1000)
  const moving = row.getBoundingClientRect().left
  expect(moving).toBeLessThan(initial)
  view.preview.setOptions({ ...changed, danmakuSpeed: 50 })
  expect(view.rows()).toContain(row)
  expect(row.getBoundingClientRect().left).toBeCloseTo(moving)
  view.preview.dispose()
  expect(vi.getTimerCount()).toBe(0)
})

it('updates plain appearance without replacing any engine and preserves progress when remeasuring text', () => {
  const view = environment()
  view.preview.setEnabled(true)
  vi.advanceTimersByTime(2000)
  const rows = view.rows(),
    positions = rows.map((row) => row.getBoundingClientRect().left),
    appearance = {
      ...danmakuDefaults,
      danmakuHoverOpacity: 80,
      danmakuOpacity: 50,
      danmakuTextStyle: 'none' as const,
    }
  view.preview.setOptions(appearance)
  expect(engines.created).toHaveBeenCalledTimes(3)
  expect(engines.destroyed).not.toHaveBeenCalled()
  for (const row of rows) row.width = 360
  view.preview.setOptions({ ...appearance, danmakuFontSize: 150 })
  for (const [index, row] of rows.entries()) {
    expect(view.rows()).toContain(row)
    expect(row.getBoundingClientRect().left).toBeCloseTo(positions[index])
  }
  view.preview.dispose()
})

it('rotates all three enabled preview types when only one track fits', () => {
  const view = environment()
  view.preview.setOptions({ ...danmakuDefaults, danmakuArea: 10 })
  view.preview.setEnabled(true)
  for (const kind of ['text', 'image', 'activity', 'text']) {
    expect(view.rows()).toHaveLength(1)
    expect(view.rows()[0].dataset.kind).toBe(kind)
    vi.advanceTimersByTime(9041)
  }
  view.preview.dispose()
  expect(vi.getTimerCount()).toBe(0)
})
