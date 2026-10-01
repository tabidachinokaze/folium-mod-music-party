// src/client/match-sdk.ts
export interface MatchNotification {
  receiverId: string
  timestamp: number
  content: string
}
export async function createMatchSdk() {
  const { NIM, V2NIMNotificationService, browserAdapters, setAdapters } =
    await import('nim-web-sdk-ng/dist/esm/nim.js')
  const memory = new Map<string, string>()
  setAdapters(() => ({
    ...browserAdapters(),
    localStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value)
      },
      removeItem: (key: string) => {
        memory.delete(key)
      },
      clear: () => memory.clear(),
    },
  }))
  NIM.registerService(V2NIMNotificationService, 'V2NIMNotificationService')
  // Public production application identifier used by the official mini-notification client.
  const nim = new NIM(
    { appkey: '363481542d57b7a75c6bd20de2e3d8db', apiVersion: 'v2', debugLevel: 'off' },
    {
      loggerConfig: { debugLevel: 'off', storageEnable: false },
    },
  )
  let closed = false
  return {
    login: (account: string, token: string) =>
      nim.V2NIMLoginService.login(account, token, {
        authType: 0,
        forceMode: false,
        retryCount: 1,
        timeout: 12000,
      }),
    onNotification: (receive: (event: MatchNotification) => void) =>
      nim.V2NIMNotificationService.on('onReceiveCustomNotifications', (events) =>
        events.forEach(receive),
      ),
    onDisconnect: (callback: () => void) => nim.V2NIMLoginService.on('onKickedOffline', callback),
    close() {
      if (closed) return
      closed = true
      // destroy is supplied by the SDK's runtime login mixin (omitted from its class declaration).
      void (nim as typeof nim & { destroy(): Promise<void> })
        .destroy()
        .catch(() => {})
        .finally(() => memory.clear())
    },
  }
}
