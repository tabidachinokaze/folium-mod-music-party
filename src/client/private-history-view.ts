import { mergePrivate } from '@party/shared/private-messages'
import type { PrivateMessage } from '@party/shared/types'
import type { preservePrivateScroll } from './private-scroll'

// src/client/private-history-view.ts
/** Keep existing resource/media nodes and their interaction state while filling message gaps. */
export function mergePrivateHistoryView(
  history: HTMLElement,
  previous: PrivateMessage[],
  incoming: PrivateMessage[],
  render: (message: PrivateMessage) => HTMLElement,
  scroll: ReturnType<typeof preservePrivateScroll>,
) {
  const known = new Set(previous.map((message) => message.id)),
    added = incoming.filter((message) => !known.has(message.id)),
    messages = mergePrivate(previous, incoming)
  if (added.length) {
    scroll.mutate(() => {
      const nodes = new Map(
        [...history.children].map((node) => [(node as HTMLElement).dataset.messageId, node]),
      )
      let next: Element | null = null
      for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        let node = nodes.get(message.id)
        if (!node) {
          node = render(message)
          history.insertBefore(node, next)
        }
        next = node
      }
    })
  }
  return { messages, added }
}
