// tests/match-sdk.mjs — injected only by the local test server, never packaged in the plugin.
export async function createMatchSdk() {
  let receive = () => {},
    closed = false,
    timer
  return {
    async login() {
      timer = setInterval(async () => {
        const event = await fetch('/test/match-notification')
          .then((r) => r.json())
          .catch(() => null)
        if (!closed && event?.content) {
          const envelope = JSON.parse(event.content),
            ext = JSON.parse(envelope.serverExt)
          receive({
            timestamp: event.timestamp,
            notice:
              ext.subType === 'STRANGER_MULTI_MATCH_WAIT_ACK'
                ? { kind: 'ready', roomId: ext.data.roomId }
                : { kind: 'failed', reason: ext.data.failedType },
          })
        }
      }, 50)
    },
    onNotification(callback) {
      receive = callback
    },
    onDisconnect() {},
    close() {
      closed = true
      clearInterval(timer)
    },
  }
}
