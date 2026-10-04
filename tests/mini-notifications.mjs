// tests/mini-notifications.mjs — only bundled by the local browser test server.
// Private notification batches are injected at the browser RPC boundary. This stub
// permits backend account setup without opening any network socket or retaining credentials.
export class MiniNotifications {
  closed = false

  async open() {
    if (this.closed) throw new Error('Test notification transport closed')
  }

  poll() {
    if (this.closed) throw new Error('Test notification transport closed')
    return []
  }

  close() {
    this.closed = true
  }
}
