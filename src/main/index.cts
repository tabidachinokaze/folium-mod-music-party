import { createBackend } from './backend'

// src/main/index.cts
type MainApi = {
  rpc: { handle(name: string, fn: (...args: any[]) => unknown): void }
  lifecycle: { onDeactivate(fn: () => void): void }
}
function activate(api: MainApi) {
  const backend = createBackend()
  api.rpc.handle('connect', (cookie: string, port: number) => backend.connect(cookie, port))
  api.rpc.handle('call', (request) => backend.call(request))
  api.rpc.handle('matchOpen', (id: string) => backend.matchOpen(id))
  api.rpc.handle('matchPoll', (id: string) => backend.matchPoll(id))
  api.rpc.handle('privateNotificationsPoll', (cursor: number, session?: string) =>
    backend.privateNotificationsPoll(cursor, session),
  )
  api.rpc.handle('privatePeer', (uid: string) => backend.privatePeer(uid))
  api.rpc.handle('matchClose', (id: string) => backend.matchClose(id))
  api.rpc.handle('media', (request) => backend.media(request))
  api.rpc.handle('removeStickers', (ids) => backend.removeStickers(ids))
  api.rpc.handle('saveSticker', (emoji) => backend.saveSticker(emoji))
  api.rpc.handle('disconnect', () => backend.close())
  api.lifecycle.onDeactivate(() => backend.close())
}
module.exports = activate
