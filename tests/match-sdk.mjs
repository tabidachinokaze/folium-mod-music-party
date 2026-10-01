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
        if (!closed && event?.content) receive(event)
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
