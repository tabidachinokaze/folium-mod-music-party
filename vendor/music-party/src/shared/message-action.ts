// vendor/music-party/src/shared/message-action.ts
export interface MessageActionTarget {
  url: string
  kind: 'web' | 'native'
  resourceType?: 'song' | 'album'
  resourceId?: string
}

const numericId = (value: string | null): value is string =>
  !!value && /^[1-9]\d{0,23}$/.test(value)
const nativeResourceId = (value: string | null): value is string =>
  !!value && /^[A-Za-z0-9_]{1,100}$/.test(value)

const resourceRoutes: Record<string, string> = {
  song: 'song',
  album: 'album',
  playlist: 'playlist',
  artist: 'artist',
  program: 'program',
  radio: 'djradio',
  djradio: 'djradio',
  mv: 'mv',
  video: 'video',
  user: 'user/home',
  topic: 'topic',
  event: 'event',
  mlog: 'mlog',
}

const uniqueParams = (url: URL, allowed: readonly string[]): boolean =>
  [...url.searchParams.keys()].every(
    (key) => allowed.includes(key) && url.searchParams.getAll(key).length === 1,
  )

function nativeEventTarget(url: URL): MessageActionTarget | undefined {
  if (!uniqueParams(url, ['id', 'userId', 'useSliderPicInDetail', 'imageIndex'])) return
  const pathId = url.pathname.replace(/^\//, '')
  const queryId = url.searchParams.get('id')
  if (pathId && queryId) return
  const id = pathId || queryId
  const userId = url.searchParams.get('userId')
  if (!numericId(id) || (userId !== null && !numericId(userId))) return
  const params = new URLSearchParams({ id })
  if (userId) params.set('uid', userId)
  return { kind: 'web', url: `https://music.163.com/event?${params}` }
}

function nativeMessageTarget(url: URL): MessageActionTarget | undefined {
  let required: Record<string, string>
  let optional: string[]
  let presentation: string[] = []
  let base: string
  if (url.hostname === 'nm' && url.pathname === '/event/topic') {
    const topicId = url.searchParams.get('topicId')
    if (!numericId(topicId)) return
    required = { topicId }
    optional = ['source']
    base = 'orpheus://nm/event/topic'
  } else if (url.hostname === 'rnpage' && ['', '/'].includes(url.pathname)) {
    const component = url.searchParams.get('component')
    if (component === 'rn-fansgroup') {
      const groupId = url.searchParams.get('groupId')
      if (!numericId(groupId) || url.searchParams.get('route') !== 'home') return
      required = { component, route: 'home', groupId }
      optional = ['scene', 'focusTabKey']
      presentation = ['isTheme', 'immersiveMode', 'split']
    } else if (component === 'rn-appointment') {
      const resourceId = url.searchParams.get('resourceId')
      if (!nativeResourceId(resourceId) || url.searchParams.get('resourceType') !== 'appointment')
        return
      required = { component, resourceType: 'appointment', resourceId }
      optional = []
      presentation = [
        'isTheme',
        'mainProcessCompat',
        'navigationBarVisible',
        'layerType',
        'heightRatio',
        'isDragCloseEnable',
        'split',
        'transparentBg',
      ]
    } else if (component === 'rn-community-fans-profile') {
      const groupId = url.searchParams.get('groupId')
      const resourceId = url.searchParams.get('resourceId')
      const artistId = url.searchParams.get('artistId')
      if (
        !numericId(groupId) ||
        !numericId(artistId) ||
        (resourceId !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(resourceId))
      )
        return
      required = { component, groupId, ...(resourceId !== null ? { resourceId } : {}), artistId }
      optional = []
      presentation = [
        'navigationBarVisible',
        'currentTheme',
        'removeNativeLoading',
        'removeNativeNetTipWhenHasCache',
        'fromPush',
      ]
    } else return
    base = 'orpheus://rnpage'
  } else if (url.hostname === 'pubevent' && ['', '/'].includes(url.pathname)) {
    // This only opens an empty editor. Direct publication or supplied content is not allowed.
    if (url.searchParams.get('directlyPub') !== 'false') return
    required = { directlyPub: 'false' }
    optional = ['tabPrimary']
    base = 'orpheus://pubevent'
  } else return
  // Known presentation hints never reach the native opener; only routing fields are rebuilt.
  if (!uniqueParams(url, [...Object.keys(required), ...optional, ...presentation])) return
  const params = new URLSearchParams(required)
  for (const key of optional) {
    const value = url.searchParams.get(key)
    if (value === null) continue
    if (!/^[\w.-]{1,100}$/.test(value)) return
    params.set(key, value)
  }
  return { kind: 'native', url: `${base}?${params}` }
}

function candidates(value: unknown, depth = 0): MessageActionTarget[] {
  if (depth > 3 || typeof value !== 'string' || value.length > 4096) return []
  try {
    // Reject credentials and explicit ports, including default ports normalized away by URL.
    const authority = value.match(/^[a-z][a-z\d+.-]*:\/\/([^/?#]*)/i)?.[1]
    if (!authority || /[@:]/.test(authority) || /[\s\\]/.test(value)) return []
    const url = new URL(value)
    if (url.username || url.password || url.port) return []
    if (url.protocol === 'orpheus:') {
      if (url.hash) return []
      const isOpen = url.hostname === 'open' && ['', '/'].includes(url.pathname)
      const isWebView = url.hostname === 'nm' && ['/redirect', '/webview'].includes(url.pathname)
      if (isOpen || isWebView) {
        const keys = isOpen ? ['url2', 'url1'] : ['url2', 'url1', 'url']
        if (!uniqueParams(url, keys)) return []
        return keys.flatMap((key) => candidates(url.searchParams.get(key), depth + 1))
      }
      if (url.hostname === 'event') {
        const event = nativeEventTarget(url)
        return event ? [event] : []
      }
      if (Object.hasOwn(resourceRoutes, url.hostname)) {
        if (!uniqueParams(url, ['id'])) return []
        const pathId = url.pathname.replace(/^\//, '')
        const queryId = url.searchParams.get('id')
        if (pathId && queryId) return []
        const id = pathId || queryId || ''
        const type = url.hostname
        if (type === 'song' || type === 'album') {
          if (!numericId(id)) return []
          return [
            {
              kind: 'web',
              url: `https://music.163.com/${type}?id=${id}`,
              resourceType: type,
              resourceId: id,
            },
          ]
        }
        if (!/^[\w-]{1,100}$/.test(id)) return []
        return [
          {
            kind: 'web',
            url: `https://music.163.com/${resourceRoutes[type]}?id=${encodeURIComponent(id)}`,
          },
        ]
      }
      const native = nativeMessageTarget(url)
      return native ? [native] : []
    }
    if (url.protocol === 'http:') url.protocol = 'https:'
    if (
      url.protocol !== 'https:' ||
      !(url.hostname === 'music.163.com' || url.hostname.endsWith('.music.163.com'))
    )
      return []
    const route = /^#\/(song|album)(?:\/)?(?:\?|$)/.test(url.hash)
      ? new URL(url.hash.slice(1), url.origin)
      : url
    const match = route.pathname.match(/^\/(song|album)\/?$/)
    if (match) {
      const id = route.searchParams.get('id')
      if (!numericId(id) || route.searchParams.getAll('id').length !== 1) return []
      const type = match[1] as 'song' | 'album'
      return [
        {
          kind: 'web',
          url: `https://music.163.com/${type}?id=${id}`,
          resourceType: type,
          resourceId: id,
        },
      ]
    }
    return [{ kind: 'web', url: url.href }]
  } catch {
    return []
  }
}

function priority(target: MessageActionTarget): number {
  if (target.resourceType) return 4
  if (target.kind === 'native') return 2
  const url = new URL(target.url)
  return url.pathname === '/' && (!url.hash || url.hash === '#/' || url.hash === '#') ? 1 : 3
}

/** Select a definite music resource before fallbacks, including nested official share links. */
export function messageActionTarget(...values: unknown[]): MessageActionTarget | undefined {
  return values.flatMap((value) => candidates(value)).sort((a, b) => priority(b) - priority(a))[0]
}

/** Only known native views, the empty event editor or official HTTPS destinations may leave the renderer. */
export function safeMessageActionUrl(...values: unknown[]): string | undefined {
  return messageActionTarget(...values)?.url
}

/** For rich-text/file links whose consumers accept only official HTTPS URLs. */
export function musicMessageWebLink(value: unknown, depth = 0): string | undefined {
  return candidates(value, depth)
    .filter((target) => target.kind === 'web')
    .sort((a, b) => priority(b) - priority(a))[0]?.url
}
