import type { Page } from '@playwright/test'
import type {
  PrivateNotificationBatch,
  PrivateNotificationEvent,
  PrivateNotice,
} from '../../src/shared/private-notices'

// tests/browser/private-notification-fixture.ts
/** Simulate only the sanitized local RPC feed; message details still use the HTTP history path. */
export async function privateNotificationFixture(page: Page) {
  let session = 'browser-private-account-9',
    generation = 0
  const events: PrivateNotificationEvent[] = [],
    polls: { cursor: number; session?: string }[] = [],
    messages: { id: number; text: string; time: number; peerUid: string; self: boolean }[] = []
  const emit = (notice: PrivateNotice) => {
    const sequence = events.length + 1
    events.push({ sequence, notice })
    return sequence
  }
  await page.route('**/rpc', async (route) => {
    const body = route.request().postDataJSON()
    if (body.name === 'privateNotificationsPoll') {
      const [cursor = 0, previousSession] = body.args
      polls.push({ cursor, session: previousSession })
      const batch: PrivateNotificationBatch = {
        session,
        cursor: events.length,
        connected: true,
        reset: !!previousSession && previousSession !== session,
        events: events.filter((event) => event.sequence > cursor),
      }
      return route.fulfill({ json: { ok: true, result: batch } })
    }
    const call = body.args[0]
    if (
      body.name !== 'call' ||
      call?.method !== 'privateHistory' ||
      call.args.before ||
      !messages.some((message) => message.peerUid === call.args.uid)
    )
      return route.continue()
    const response = await route.fetch(),
      json = await response.json()
    json.result.data.msgs.push(
      ...messages
        .filter((message) => message.peerUid === call.args.uid)
        .map((message) => ({
          id: message.id,
          time: message.time,
          fromUser: message.self
            ? { userId: 9, nickname: '晚风' }
            : { userId: Number(message.peerUid), nickname: '听友' },
          toUser: { userId: message.self ? Number(message.peerUid) : 9 },
          msg: JSON.stringify({ msg: message.text, type: 1 }),
        })),
    )
    await route.fulfill({ json })
  })
  return {
    polls,
    push(text: string, options: { peerUid?: string; self?: boolean; timestamp?: number } = {}) {
      const sequence = events.length + 1,
        message = {
          id: 99000 + sequence,
          text,
          time: options.timestamp ?? Date.now() + sequence,
          peerUid: options.peerUid ?? '10',
          self: options.self ?? false,
        }
      messages.push(message)
      return emit({
        kind: 'message',
        id: `message:${message.id}`,
        peerUid: message.peerUid,
        senderUid: message.self ? '9' : message.peerUid,
        senderName: message.self
          ? '晚风'
          : message.peerUid === '10'
            ? '小岛'
            : message.peerUid === '11'
              ? '远山'
              : '云影',
        senderAvatar: 'https://p1.music.126.net/fixture/avatar.jpg',
        messageId: String(message.id),
        timestamp: message.time,
        messageType: 1,
        text,
        self: message.self,
      })
    },
    sync() {
      return emit({ kind: 'sync', id: `sync:${events.length + 1}`, timestamp: Date.now() })
    },
    repeat(sequence: number) {
      const previous = events.find((event) => event.sequence === sequence)
      if (!previous) throw new Error('Unknown test notification sequence')
      return emit(previous.notice)
    },
    resetAccount() {
      session = `browser-private-account-9:${++generation}`
      events.length = 0
      messages.length = 0
    },
  }
}
