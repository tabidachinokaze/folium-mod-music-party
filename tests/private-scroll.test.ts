import { describe, expect, it } from 'vitest'
import { preservePrivateScroll } from '../src/client/private-scroll'

// tests/private-scroll.test.ts
function setup() {
  let top = 700,
    messageTop = 800
  const history = Object.assign(new EventTarget(), {
    scrollHeight: 1000,
    clientHeight: 300,
    getBoundingClientRect: () => ({ top: 20 }),
    children: [] as unknown[],
  })
  Object.defineProperty(history, 'scrollTop', {
    get: () => top,
    set: (value: number) => {
      top = Math.min(history.scrollHeight - history.clientHeight, Math.max(0, value))
    },
  })
  history.children.push({
    parentElement: history,
    getBoundingClientRect: () => ({ top: 20 + messageTop - top, bottom: 60 + messageTop - top }),
  })
  const element = history as unknown as HTMLElement,
    scroll = preservePrivateScroll(element)
  return { history: element, scroll, moveMessage: (value: number) => (messageTop = value) }
}
describe('private media scroll anchoring', () => {
  it('keeps the latest messages in view when a new lazy picture obtains its real height', () => {
    const { history, scroll } = setup()
    scroll.capture()
    Object.assign(history, { scrollHeight: 1200 })
    history.dispatchEvent(new Event('load'))
    expect(history.scrollTop).toBe(900)
    scroll.dispose()
  })
  it('preserves the first visible message offset while reading older messages', () => {
    const { history, scroll, moveMessage } = setup()
    history.scrollTop = 400
    moveMessage(420)
    scroll.capture()
    Object.assign(history, { scrollHeight: 1200 })
    moveMessage(620)
    history.dispatchEvent(new Event('loadedmetadata'))
    expect(history.scrollTop).toBe(600)
    scroll.dispose()
    moveMessage(720)
    history.dispatchEvent(new Event('load'))
    expect(history.scrollTop).toBe(600)
  })
  it('does not use a removed conversation node as the next conversation’s anchor', () => {
    const { history, scroll } = setup()
    history.scrollTop = 400
    scroll.capture()
    Object.assign(history.children[0], { parentElement: null })
    history.dispatchEvent(new Event('load'))
    expect(history.scrollTop).toBe(400)
    scroll.dispose()
  })
})
