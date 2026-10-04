import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parsePrivateNotice, PRIVATE_REALTIME_BIZ } from '../src/main/private-notice'

// tests/private-notice.test.ts
const message = (changes: Record<string, unknown> = {}) => ({
  scene: 1,
  channelId: '8',
  senderUserId: '8',
  clientUiFlag: true,
  msgBody: { msgId: 'message-42', msgTime: 1700000000000, msgType: 1, text: { textBody: '你好' } },
  ...changes,
})
const envelope = (raw: unknown, changes: Record<string, unknown> = {}) => ({
  msgType: 133,
  bizType: PRIVATE_REALTIME_BIZ,
  serverExt: JSON.stringify({
    data: gzipSync(typeof raw === 'string' ? raw : JSON.stringify(raw)).toString('base64'),
  }),
  ...changes,
})

describe('official private realtime notifications', () => {
  it('decodes the retained APK format, keeps previews plain and exports only the narrow DTO', () => {
    expect(parsePrivateNotice(JSON.stringify(envelope(message())), 1700000001000, '9')).toEqual({
      kind: 'message',
      id: '8:message-42:1',
      peerUid: '8',
      senderUid: '8',
      messageId: 'message-42',
      timestamp: 1700000000000,
      messageType: 1,
      text: '你好',
      self: false,
    })
  })

  it.each([2, 4, 6, 47, 5000])(
    'accepts non-text type %i without needing to interpret its body',
    (msgType) => {
      const notice = parsePrivateNotice(
        envelope(
          message({
            msgBody: {
              msgId: 'resource',
              msgType,
              briefText: '[资源消息]',
              body: '{"unknown":true}',
            },
          }),
        ),
        1234,
        '9',
      )
      expect(notice).toMatchObject({
        kind: 'message',
        messageType: msgType,
        text: '[资源消息]',
        timestamp: 1234,
      })
    },
  )

  it('keeps own multi-device echoes distinct and filters notices addressed to other accounts', () => {
    const raw = message({ senderUserId: '9', targetUserList: '["9"]' })
    expect(parsePrivateNotice(envelope(raw, { msgType: 132 }), 1234, '9')?.self).toBe(true)
    expect(parsePrivateNotice(envelope({ ...raw, targetUserList: '["88"]' }), 1234, '9')).toBeNull()
    expect(parsePrivateNotice(envelope({ ...raw, targetUserList: '' }), 1234, '9')).not.toBeNull()
    expect(
      parsePrivateNotice(envelope({ ...raw, targetUserList: 'malformed' }), 1234, '9'),
    ).toBeNull()
  })

  it('preserves large numeric message IDs instead of rounding them', () => {
    const raw = JSON.stringify(message()).replace('"message-42"', '9223372036854775001')
    expect(parsePrivateNotice(envelope(raw), 1234, '9')?.messageId).toBe('9223372036854775001')
  })

  it('treats commands and hidden notifications as invalidations and does not collapse distinct commands', () => {
    const raw = message({
      senderUserId: '0',
      msgBody: { msgId: 'command', msgType: 99, body: 'first' },
    })
    const first = parsePrivateNotice(envelope(raw), 1234, '9')
    const second = parsePrivateNotice(
      envelope({ ...raw, msgBody: { ...raw.msgBody, body: 'second' } }),
      1234,
      '9',
    )
    expect(first?.kind).toBe('change')
    expect(second?.id).not.toBe(first?.id)
    expect(parsePrivateNotice(envelope(message({ clientUiFlag: false })), 1234, '9')?.kind).toBe(
      'change',
    )
  })

  it.each([
    envelope(message(), { bizType: 'music_listenTogether_multi_match_song' }),
    envelope(message(), { bizType: 'music_communication_retrieve_msg_notice' }),
    envelope(message(), { msgType: 1000 }),
    envelope(message({ scene: 3 })),
    envelope(message({ channelId: '9' })),
    envelope(message({ channelId: '<script>' })),
    envelope(message({ msgBody: {} })),
    { msgType: 133, bizType: PRIVATE_REALTIME_BIZ, serverExt: { data: 'not+gzip' } },
    { msgType: 133, bizType: PRIVATE_REALTIME_BIZ, serverExt: { data: '!!!' } },
  ])('ignores unrelated or malformed input without throwing (%#)', (input) => {
    expect(parsePrivateNotice(input, 1234, '9')).toBeNull()
  })

  it('bounds decompression and preview size', () => {
    expect(
      parsePrivateNotice(envelope(message({ padding: 'x'.repeat(600000) })), 1234, '9'),
    ).toBeNull()
    const notice = parsePrivateNotice(
      envelope(
        message({
          msgBody: { msgId: 'preview', msgType: 1, text: { textBody: '\0' + 'a'.repeat(1000) } },
        }),
      ),
      1234,
      '9',
    )
    expect(notice?.text).toBe('a'.repeat(500))
  })

  it.each([1, 2, 4, 6, 47, 5000])(
    'extracts verified sender metadata for message type %i',
    (msgType) => {
      const raw = message()
      const notice = parsePrivateNotice(
        envelope({
          ...raw,
          msgBody: {
            ...raw.msgBody,
            msgType,
            sender: {
              user: {
                userId: 8,
                nickname: '\0 Peer\n',
                avatarUrl: 'http://p1.music.126.net/avatar.png',
                lastLoginIP: 'private-ip',
              },
              roleType: 1,
            },
          },
        }),
        1234,
        '9',
      )
      expect(notice).toMatchObject({
        senderUid: '8',
        senderName: 'Peer',
        senderAvatar: 'https://p1.music.126.net/avatar.png',
        text: '你好',
        messageType: msgType,
      })
      expect(JSON.stringify(notice)).not.toContain('private-ip')
    },
  )

  it.each([{ user: { userId: 8, nickname: 'Peer' } }, { userId: '8', nickname: 'Peer' }])(
    'uses nested and legacy sender IDs when the envelope omits senderUserId',
    (sender) => {
      const raw = message()
      const notice = parsePrivateNotice(
        envelope({ ...raw, senderUserId: undefined, msgBody: { ...raw.msgBody, sender } }),
        1234,
        '9',
      )
      expect(notice).toMatchObject({ senderUid: '8', senderName: 'Peer', self: false })
    },
  )

  it.each([
    {
      user: { userId: 7, nickname: 'Wrong user', avatarUrl: 'https://p1.music.126.net/wrong.png' },
    },
    { user: { nickname: 'Unidentified' } },
    '{bad-json',
    { user: '{bad-json' },
  ])(
    'ignores malformed or mismatched optional sender profiles without dropping the message',
    (sender) => {
      const raw = message()
      const notice = parsePrivateNotice(
        envelope({ ...raw, msgBody: { ...raw.msgBody, sender } }),
        1234,
        '9',
      )
      expect(notice).toMatchObject({ senderUid: '8', text: '你好' })
      expect(notice).not.toHaveProperty('senderName')
      expect(notice).not.toHaveProperty('senderAvatar')
    },
  )

  it('bounds names and omits unsafe sender avatars', () => {
    const raw = message()
    const notice = parsePrivateNotice(
      envelope({
        ...raw,
        msgBody: {
          ...raw.msgBody,
          sender: {
            user: { userId: 8, nickname: 'p'.repeat(1000), avatarUrl: 'data:image/svg+xml,unsafe' },
          },
        },
      }),
      1234,
      '9',
    )
    expect(notice?.senderName).toBe('p'.repeat(160))
    expect(notice).not.toHaveProperty('senderAvatar')
  })
})
