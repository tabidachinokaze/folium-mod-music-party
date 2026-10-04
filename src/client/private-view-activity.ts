import type { PartyController } from './controller'
import type { PrivateMessage } from '@party/shared/types'

export type PrivateReadBoundary = {
  timestamp: number
  /** Actual server IDs at timestamp; other messages in that millisecond remain unread. */
  messageIds: readonly string[]
}

export function privateReadBoundary(
  messages: readonly Pick<PrivateMessage, 'id' | 'time' | 'senderId'>[],
  selfUid: string,
): PrivateReadBoundary {
  let timestamp = 0
  const messageIds = new Set<string>()
  for (const message of messages) {
    if (message.senderId === selfUid || !Number.isSafeInteger(message.time) || message.time <= 0)
      continue
    if (message.time < timestamp) continue
    if (message.time > timestamp) {
      timestamp = message.time
      messageIds.clear()
    }
    // parsePrivatePage prefixes authoritative HTTP IDs; synthesized fallback IDs
    // cannot prove that an equal-time realtime notification has been loaded.
    if (message.id.startsWith('server:')) messageIds.add(message.id.slice(7))
  }
  return { timestamp, messageIds: [...messageIds] }
}

// Reading is shared across the home inbox and player bubbles; receiving is never reading.
const scopes = new WeakMap<
  PartyController,
  {
    views: Set<{ peer(): string | null; active(): boolean }>
    listeners: Set<(uid: string, boundary: PrivateReadBoundary) => void>
  }
>()

function scope(controller: PartyController) {
  let value = scopes.get(controller)
  if (!value) {
    value = { views: new Set(), listeners: new Set() }
    scopes.set(controller, value)
  }
  return value
}

export function trackPrivateView(
  controller: PartyController,
  peer: () => string | null,
  active: () => boolean,
) {
  const views = scope(controller).views,
    entry = { peer, active }
  views.add(entry)
  return () => {
    views.delete(entry)
  }
}

export function privateConversationVisible(controller: PartyController, uid: string) {
  return [...scope(controller).views].some((view) => view.peer() === uid && view.active())
}

export function publishPrivateRead(
  controller: PartyController,
  uid: string,
  boundary: PrivateReadBoundary,
) {
  for (const listener of scope(controller).listeners) listener(uid, boundary)
}

export function subscribePrivateRead(
  controller: PartyController,
  listener: (uid: string, boundary: PrivateReadBoundary) => void,
) {
  const listeners = scope(controller).listeners
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
