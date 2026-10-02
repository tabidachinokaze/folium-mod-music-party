import { describe, expect, it } from 'vitest'
import {
  messageActionTarget,
  musicMessageLink,
  richMessageContent,
  safeMessageActionUrl,
} from '../vendor/music-party/src/shared/message-content'

// tests/private-resource-links.test.ts
const wrap = (url1: string, url2?: string) =>
  `orpheus://open?${new URLSearchParams({ url1, ...(url2 ? { url2 } : {}) })}`
const card = (overrides: Record<string, unknown> = {}) => ({
  type: 23,
  generalMsg: {
    title: '海风来信',
    subTitle: '虚构歌手',
    cover: 'https://p1.music.126.net/fixture/cover.jpg',
    tag: '专辑',
    canPlay: false,
    resId: -1,
    webUrl: 'https://music.163.com/',
    ...overrides,
  },
})

describe('generic music cards', () => {
  it('uses the definite album in an open wrapper instead of the generic homepage', () => {
    const nativeUrl = wrap('https://music.163.com/', 'https://music.163.com/#/album?id=712')
    expect(richMessageContent(card({ nativeUrl })).attachments).toEqual([
      expect.objectContaining({
        kind: 'resource',
        resourceType: 'album',
        resourceId: '712',
        title: '海风来信',
        subtitle: '虚构歌手',
        artist: '虚构歌手',
        label: '专辑',
        cover: 'https://p1.music.126.net/fixture/cover.jpg',
        actionUrl: 'https://music.163.com/album?id=712',
      }),
    ])
  })

  it('recognizes a definite song regardless of resId, canPlay or the promotional tag', () => {
    const attachment = richMessageContent(
      card({
        tag: '',
        nativeUrl: wrap('orpheus://song/713'),
      }),
    ).attachments![0]
    expect(attachment).toMatchObject({
      resourceType: 'song',
      resourceId: '713',
      artist: '虚构歌手',
      actionUrl: 'https://music.163.com/song?id=713',
    })
    expect(attachment.label).toBeUndefined()
  })

  it('retains appointment promotions as generic cards while preserving music preview metadata', () => {
    const nativeUrl =
      'orpheus://rnpage?component=rn-appointment&resourceType=appointment&resourceId=714'
    const attachment = richMessageContent(card({ nativeUrl })).attachments![0]
    expect(attachment).toMatchObject({
      resourceType: 'general',
      resourceId: '-1',
      artist: '虚构歌手',
      label: '专辑',
      actionUrl: nativeUrl,
    })
    expect(messageActionTarget(nativeUrl)).toEqual({ kind: 'native', url: nativeUrl })
  })

  it.each([
    'https://music.163.com/',
    'https://music.163.com/album',
    'https://music.163.com/album?id=-1',
    'orpheus://unknown/715',
  ])('does not infer music identity from a tag and an ambiguous target: %s', (nativeUrl) => {
    expect(richMessageContent(card({ nativeUrl })).attachments![0]).toMatchObject({
      resourceType: 'general',
      resourceId: '-1',
      label: '专辑',
    })
  })

  it('keeps tag and subtitle-derived credits bounded and does not coerce tag objects into text', () => {
    const attachment = richMessageContent(
      card({
        tag: '歌曲',
        subTitle: '字'.repeat(2000),
        nativeUrl: 'orpheus://song/716',
      }),
    ).attachments![0]
    expect(attachment.artist).toHaveLength(1000)
    expect(richMessageContent(card({ tag: '字'.repeat(200) })).attachments![0].label).toHaveLength(
      80,
    )
    expect(
      richMessageContent(card({ tag: { title: '歌曲' } })).attachments![0].label,
    ).toBeUndefined()
  })
})

describe('safe message actions', () => {
  it('supports nested wrappers and existing HTTPS-only resource links', () => {
    const nested = `orpheus://nm/webview?${new URLSearchParams({ url: wrap('https://music.163.com/#/song?id=721') })}`
    expect(messageActionTarget(nested)).toEqual({
      kind: 'web',
      url: 'https://music.163.com/song?id=721',
      resourceType: 'song',
      resourceId: '721',
    })
    expect(musicMessageLink(nested)).toBe('https://music.163.com/song?id=721')
    expect(musicMessageLink('orpheus://playlist/722')).toBe('https://music.163.com/playlist?id=722')
    expect(musicMessageLink('http://music.163.com/album?id=723')).toBe(
      'https://music.163.com/album?id=723',
    )
    expect(safeMessageActionUrl(wrap(wrap(wrap(wrap('orpheus://song/724')))))).toBeUndefined()
  })

  it.each([
    'orpheus://nm/event/topic?topicId=731&source=share',
    'orpheus://rnpage?component=rn-fansgroup&route=home&groupId=732&scene=message&focusTabKey=activity',
    'orpheus://rnpage?component=rn-appointment&resourceType=appointment&resourceId=733',
  ])('retains only the observed read-only native route: %s', (nativeUrl) => {
    expect(safeMessageActionUrl('https://music.163.com/', nativeUrl)).toBe(nativeUrl)
    expect(safeMessageActionUrl(wrap(nativeUrl))).toBe(nativeUrl)
    expect(musicMessageLink(nativeUrl)).toBeUndefined()
    expect(messageActionTarget(nativeUrl)?.resourceId).toBeUndefined()
  })

  it('prefers a real official web fallback for native cards and normalizes native parameter order', () => {
    const native = 'orpheus://nm/event/topic?source=share&topicId=731'
    expect(safeMessageActionUrl(native)).toBe('orpheus://nm/event/topic?topicId=731&source=share')
    expect(safeMessageActionUrl(native, 'https://st.music.163.com/activity/fixture')).toBe(
      'https://st.music.163.com/activity/fixture',
    )
  })

  it.each<{ params: Record<string, string>; display: Record<string, string> }>([
    {
      params: {
        component: 'rn-fansgroup',
        route: 'home',
        groupId: '1234567890123456789',
        scene: 'PRIVATE_MSG',
        focusTabKey: 'ArtistFansRelationGuest',
      },
      display: { isTheme: 'true', immersiveMode: 'true', split: '1' },
    },
    {
      params: {
        component: 'rn-appointment',
        resourceType: 'appointment',
        resourceId: 'fixture_appointment_01',
      },
      display: {
        isTheme: '1',
        mainProcessCompat: 'true',
        navigationBarVisible: 'false',
        layerType: '1',
        heightRatio: '0.8',
        isDragCloseEnable: 'true',
        split: '0',
        transparentBg: 'true',
      },
    },
    {
      params: {
        component: 'rn-community-fans-profile',
        groupId: '1234567890123456789',
        resourceId: 'fixture_profile_01',
        artistId: '12345678',
      },
      display: {
        navigationBarVisible: 'false',
        currentTheme: 'dark',
        removeNativeLoading: 'true',
        removeNativeNetTipWhenHasCache: '1',
        fromPush: 'true',
      },
    },
  ])(
    'keeps verified native card routes while dropping their presentation hints: $params.component',
    ({ params, display }) => {
      const canonical = `orpheus://rnpage?${new URLSearchParams(params)}`
      const observed = `orpheus://rnpage?${new URLSearchParams({ ...params, ...display })}`
      expect(safeMessageActionUrl(observed)).toBe(canonical)
      expect(safeMessageActionUrl(canonical)).toBe(canonical)
      expect(richMessageContent(card({ nativeUrl: observed })).attachments![0]).toMatchObject({
        resourceType: 'general',
        resourceId: '-1',
        actionUrl: canonical,
      })
      expect(messageActionTarget(observed)?.resourceId).toBeUndefined()
    },
  )

  it('only opens an empty event editor and preserves the validated optional tab', () => {
    expect(safeMessageActionUrl('orpheus://pubevent?directlyPub=false')).toBe(
      'orpheus://pubevent?directlyPub=false',
    )
    expect(safeMessageActionUrl('orpheus://pubevent?tabPrimary=music&directlyPub=false')).toBe(
      'orpheus://pubevent?directlyPub=false&tabPrimary=music',
    )
  })

  it.each([undefined, 'abc_fixture-profile_0123456789', '123_fixture-profile_0123456789'])(
    'accepts optional or opaque profile resource identities: %s',
    (resourceId) => {
      const route = {
        component: 'rn-community-fans-profile',
        groupId: '1234567890123456789',
        ...(resourceId !== undefined ? { resourceId } : {}),
        artistId: '12345678',
      }
      const nativeUrl = `orpheus://rnpage?${new URLSearchParams({
        ...route,
        currentTheme: 'color_black',
        navigationBarVisible: '0',
        removeNativeLoading: '1',
        removeNativeNetTipWhenHasCache: 'true',
        fromPush: 'true',
      })}`
      expect(safeMessageActionUrl(nativeUrl)).toBe(`orpheus://rnpage?${new URLSearchParams(route)}`)
      expect(messageActionTarget(nativeUrl)?.resourceType).toBeUndefined()
    },
  )

  it('maps native event details to the official web route with its user identity', () => {
    expect(
      safeMessageActionUrl(
        'orpheus://event?id=1234567890123456789&userId=987654321&useSliderPicInDetail=true&imageIndex=2',
      ),
    ).toBe('https://music.163.com/event?id=1234567890123456789&uid=987654321')
    expect(safeMessageActionUrl('orpheus://event/731')).toBe('https://music.163.com/event?id=731')
    expect(safeMessageActionUrl('orpheus://event?id=731')).toBe(
      'https://music.163.com/event?id=731',
    )
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'file:///tmp/fixture',
    'https://music.163.com.evil.invalid/song?id=1',
    'https://user:pass@music.163.com/song?id=1',
    'https://music.163.com:443/song?id=1',
    'orpheus://user@rnpage?component=rn-appointment&resourceType=appointment&resourceId=1',
    'orpheus://rnpage:123?component=rn-appointment&resourceType=appointment&resourceId=1',
    'orpheus://delete/1',
    'orpheus://rnpage?component=rn-checkout&resourceId=1',
    'orpheus://nm/event/topic?topicId=1&topicId=2',
    'orpheus://nm/event/topic?topicId=1&command=delete',
    'orpheus://rnpage?component=rn-fansgroup&route=join&groupId=1',
    'orpheus://rnpage?component=rn-fansgroup&route=home&groupId=-1',
    'orpheus://rnpage?component=rn-appointment&resourceType=song&resourceId=1',
    'orpheus://rnpage?component=rn-appointment&resourceType=appointment&resourceId=1&autoSubmit=1',
    'orpheus://nm/event/topic?topicId=1#command',
    'https://music.163.com/#/song?id=1&id=2',
    'orpheus://song/1?id=2',
    'orpheus://song/-1',
    'orpheus://open?url1=https%3A%2F%2Fmusic.163.com%2Fsong%3Fid%3D1&command=delete',
    'orpheus://rnpage?component=rn-community-fans-profile&groupId=1&resourceId=fixture%2Fpath&artistId=2',
    'orpheus://rnpage?component=rn-community-fans-profile&groupId=1&resourceId=fixture_profile&artistId=-1',
    'orpheus://rnpage?component=rn-appointment&resourceType=appointment&resourceId=fixture.appointment',
    'orpheus://pubevent?directlyPub=true',
    'orpheus://pubevent?directlyPub=false&directlyPub=true',
    'orpheus://pubevent?tabPrimary=music',
    'orpheus://pubevent?directlyPub=false&content=hello',
    'orpheus://pubevent?directlyPub=false&payload=hello',
    'orpheus://pubevent?directlyPub=false&tabPrimary=music%26directlyPub%3Dtrue',
    'orpheus://event?id=1&userId=-1',
    'orpheus://event?id=1&userId=2&userId=3',
    'orpheus://event?id=1&command=delete',
  ])('rejects unsafe or ambiguous targets: %s', (url) => {
    expect(safeMessageActionUrl(url)).toBeUndefined()
  })
})
