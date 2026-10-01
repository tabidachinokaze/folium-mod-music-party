import { afterEach, expect, it, vi } from 'vitest'
import { parseInvitation } from '../vendor/music-party/src/shared/protocol'
import { PartyController } from '../src/client/controller'
import { setLocale, t } from '../src/client/i18n'
import { createBackend } from '../src/main/backend'
import { fakeHost } from './fixtures'

// tests/error-localization.test.ts
afterEach(() => setLocale('zh-CN'))
const base = 'https://st.music.163.com/listen-together/multishare/index.html'

it.each([
  ['not a link', 'Paste the full NetEase multiplayer invite link.'],
  ['https://%', 'The invite link is not a valid URL.'],
  ['https://example.com/room', 'Use an official NetEase multiplayer invite link.'],
  [
    'https://st.music.163.com/listen-together/share',
    'This invite is for two listeners. Copy a multiplayer room link from the official app.',
  ],
  ['https://st.music.163.com/other', 'This NetEase multiplayer invite link is not supported.'],
  [base, 'The invite link has duplicate or missing parameters.'],
  [
    `${base}?roomId=room&inviterUid=9&isFLT=true`,
    'This is a follow-listening link. Only official multiplayer rooms are supported.',
  ],
  [
    `${base}?roomId=room&inviterUid=invalid`,
    'The invite link has an invalid roomId or inviterUid.',
  ],
])(
  'localizes an invitation boundary error from %s without changing the parser',
  (input, english) => {
    let error: Error | undefined
    try {
      parseInvitation(input)
    } catch (caught) {
      error = caught as Error
    }
    expect(error).toBeInstanceOf(Error)
    const source = error!.message
    setLocale('en')
    expect(t(source)).toBe(english)
    setLocale('zh-CN')
    expect(t(source)).toBe(source)
  },
)

it('uses the current locale when a local invitation error reaches the host toast', async () => {
  const { folium } = fakeHost()
  vi.mocked(folium.rpc.call).mockResolvedValue(undefined)
  const controller = new PartyController(folium)
  try {
    setLocale('en')
    await controller.run(() => controller.enter('join', 'invalid'))
    expect(folium.ui.toast).toHaveBeenCalledWith(
      'Paste the full NetEase multiplayer invite link.',
      expect.objectContaining({ type: 'error' }),
    )
    expect(folium.rpc.call).not.toHaveBeenCalled()
  } finally {
    controller.dispose()
  }
})

it('translates the local room-creation failure while preserving free-form server errors', async () => {
  let serverMessage = ''
  const fetcher = vi.fn(
    async (url: any) =>
      new Response(
        JSON.stringify(
          String(url).includes('/register/checktoken/v3')
            ? { code: 200, token: 'test-token' }
            : {
                code: 200,
                data: {
                  success: false,
                  failedType: 'MULTI_SONG_NOT_SATISFIED',
                  failedMessage: serverMessage,
                },
              },
        ),
      ),
  )
  const backend = createBackend(fetcher as typeof fetch)
  backend.connect('MUSIC_U=test-only', 30123)
  setLocale('en')
  try {
    const failure = await backend.call({ method: 'multiCreate', args: { songId: '1' } })
    expect(failure.ok).toBe(false)
    expect(t(failure.error!)).toBe(
      'This song cannot be used to create an official multiplayer room. Try a song available in full.',
    )
    serverMessage = '服务端自定义说明：本次请求尚未完成'
    const custom = await backend.call({ method: 'multiCreate', args: { songId: '1' } })
    expect(custom.ok).toBe(false)
    expect(t(custom.error!)).toBe(serverMessage)
  } finally {
    backend.close()
  }
})
