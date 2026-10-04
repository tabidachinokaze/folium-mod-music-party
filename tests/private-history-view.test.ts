import { describe, expect, it, vi } from 'vitest'
import type { PrivateMessage } from '@party/shared/types'
import { mergePrivateHistoryView } from '../src/client/private-history-view'

// tests/private-history-view.test.ts
const message = (time: number): PrivateMessage => ({
  id: String(time),
  time,
  text: `message ${time}`,
  senderId: '1',
  recipientId: '2',
  invitations: [],
})
function setup(previous: PrivateMessage[]) {
  const makeNode = (value: PrivateMessage) =>
      ({ dataset: { messageId: value.id } }) as unknown as HTMLElement,
    nodes = previous.map(makeNode),
    history = {
      children: [...nodes],
      insertBefore(node: HTMLElement, next: HTMLElement | null) {
        const index = next ? this.children.indexOf(next) : this.children.length
        this.children.splice(index, 0, node)
      },
    },
    render = vi.fn(makeNode),
    scroll = { capture: vi.fn(), dispose: vi.fn(), mutate: vi.fn((change: () => void) => change()) }
  return { history, nodes, render, scroll }
}
describe('private-history incremental rendering', () => {
  it('preserves loaded media and its state while inserting a missing range and new messages in order', () => {
    const previous = [message(1), message(4)],
      x = setup(previous),
      result = mergePrivateHistoryView(
        x.history as unknown as HTMLElement,
        previous,
        [message(2), message(4), message(5)],
        x.render,
        x.scroll,
      )
    expect(result.messages.map((value) => value.id)).toEqual(['1', '2', '4', '5'])
    expect(result.added.map((value) => value.id)).toEqual(['2', '5'])
    expect(x.history.children.map((node) => node.dataset.messageId)).toEqual(['1', '2', '4', '5'])
    expect(x.history.children[0]).toBe(x.nodes[0])
    expect(x.history.children[2]).toBe(x.nodes[1])
    expect(x.render).toHaveBeenCalledTimes(2)
    expect(x.scroll.mutate).toHaveBeenCalledOnce()
  })
  it('leaves the DOM and scroll position untouched when a poll has no new messages', () => {
    const previous = [message(1), message(2)],
      x = setup(previous),
      result = mergePrivateHistoryView(
        x.history as unknown as HTMLElement,
        previous,
        [message(2)],
        x.render,
        x.scroll,
      )
    expect(result.added).toEqual([])
    expect(x.history.children).toEqual(x.nodes)
    expect(x.render).not.toHaveBeenCalled()
    expect(x.scroll.mutate).not.toHaveBeenCalled()
  })
})
