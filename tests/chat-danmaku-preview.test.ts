import { afterEach, expect, it, vi } from 'vitest'
import type { PartyController } from '../src/client/controller'
import { mountDanmaku } from '../src/client/chat-danmaku'
import { danmakuDefaults } from '../src/client/chat-preferences'
import { danmakuPreviewImage } from '../src/client/chat-danmaku-preview'

const engines = vi.hoisted(() => ({ created: vi.fn(), destroyed: vi.fn() }))
vi.mock('danmaku/dist/esm/danmaku.dom.js', () => ({
  default: class {
    constructor(private options: { container: { append(node: unknown): void } }) {
      engines.created()
    }
    emit(comment: { render(): unknown }) {
      this.options.container.append(comment.render())
    }
    destroy() {
      engines.destroyed()
    }
  },
}))

class Element extends EventTarget {
  className = ''
  dataset: Record<string, string> = {}
  style = { setProperty: vi.fn() }
  children: Element[] = []
  parent: Element | null = null
  shadowRoot: Element | null = null
  src = ''
  textContent = ''
  append(...nodes: Element[]) {
    for (const node of nodes) {
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
    return { width: 1100, height: 800 }
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
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

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

it('replays changed settings, honours content filters and visibility, and bounds each repeat', () => {
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
  expect(view.rows()).toHaveLength(0)
  expect(vi.getTimerCount()).toBe(1)
  vi.advanceTimersByTime(600)
  expect(view.rows()).toHaveLength(3)
  expect(view.rows().every((row) => !ids.includes(row.dataset.messageId))).toBe(true)
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
