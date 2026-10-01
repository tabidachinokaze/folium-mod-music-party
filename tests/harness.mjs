import activate from '/client.mjs'

// tests/harness.mjs
if (!new URL(location.href).searchParams.has('loggedout'))
  localStorage.setItem('online_provider:netease:cookie', 'MUSIC_U=test-only')
else localStorage.removeItem('online_provider:netease:cookie')
localStorage.setItem('active_online_provider_id', 'netease')
window.electron = { getNeteasePort: async () => 4176 }
const events = new Map(),
  state = {
    song: { id: '1', source: 'netease', ref: '1', title: '晚风与海', artist: '岛屿来信' },
    state: 'playing',
    duration: 30,
    position: 5,
  }
const emit = (name, value) => events.get(name)?.forEach((fn) => fn(value))
const searchCalls = []
let panel, home, mounted, intent, queue
const panelNode = document.querySelector('#panel')
panelNode.dataset.testid = 'unified-panel-surface'
const homeNode = document.createElement('div')
homeNode.id = 'private-home'
homeNode.hidden = true
document.body.append(homeNode)
const themes = {
  dark: {
    backgroundColor: '#101112',
    primaryColor: '#e9e5e5',
    secondaryColor: '#999595',
    accentColor: '#e9e5e5',
    isDaylight: false,
  },
  light: {
    backgroundColor: '#f7f7f5',
    primaryColor: '#252525',
    secondaryColor: '#777777',
    accentColor: '#3665af',
    isDaylight: true,
  },
  blue: {
    backgroundColor: '#142331',
    primaryColor: '#d7e6f2',
    secondaryColor: '#8dabbf',
    accentColor: '#85b8e8',
    isDaylight: false,
  },
}
let currentTheme = themes.dark
const themeListeners = new Set()
const context = {
  locale: 'zh-CN',
  getTheme: () => currentTheme,
  subscribe(fn) {
    themeListeners.add(fn)
    return () => themeListeners.delete(fn)
  },
}
function setLocale(locale) {
  document.documentElement.lang = locale
  context.locale = locale
  privateButton.textContent = locale === 'en' ? 'Direct messages' : '私信'
  roomButton.textContent = locale === 'en' ? 'Listen together' : '一起听'
  // Folia remounts mod surfaces when its locale context changes, retaining the controller.
  if (panel) {
    mounted?.()
    mounted = panel.mount(panelNode, context)
  }
  if (homeMounted) {
    homeMounted()
    homeMounted = home.mount(homeNode, context)
  }
  if (!queueNode.hidden) renderQueue()
}
function setTheme(name) {
  currentTheme = themes[name]
  document.body.style.background = currentTheme.backgroundColor
  document.body.style.color = currentTheme.primaryColor
  document.body.style.colorScheme = currentTheme.isDaylight ? 'light' : 'dark'
  for (const node of [panelNode, homeNode]) {
    for (const [key, value] of Object.entries({
      bg: currentTheme.backgroundColor,
      primary: currentTheme.primaryColor,
      secondary: currentTheme.secondaryColor,
      accent: currentTheme.accentColor,
      font: 'system-ui, sans-serif',
    }))
      node.style.setProperty(`--folium-${key}`, value)
  }
  themeListeners.forEach((fn) => fn())
}
setTheme('dark')
const privateButton = document.createElement('button')
privateButton.textContent = '私信'
privateButton.hidden = true
document.body.prepend(privateButton)
const roomButton = document.createElement('button')
roomButton.textContent = '一起听'
roomButton.hidden = true
const previewBar = document.createElement('div')
previewBar.style.cssText =
  'display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:12px;font:12px system-ui'
const label = document.createElement('span')
label.textContent = '模拟预览'
const loginButton = document.createElement('button')
const provider = document.createElement('select')
provider.setAttribute('aria-label', '模拟音乐来源')
for (const [value, title] of [
  ['netease', '网易云'],
  ['qq', '其他音乐来源'],
]) {
  const option = document.createElement('option')
  option.value = value
  option.textContent = title
  provider.append(option)
}
const updateLoginLabel = () => {
  loginButton.textContent = localStorage.getItem('online_provider:netease:cookie')
    ? '模拟退出登录'
    : '模拟登录网易云'
}
loginButton.onclick = () => {
  if (localStorage.getItem('online_provider:netease:cookie'))
    localStorage.removeItem('online_provider:netease:cookie')
  else localStorage.setItem('online_provider:netease:cookie', 'MUSIC_U=test-only')
  updateLoginLabel()
  window.dispatchEvent(new Event('storage'))
}
provider.onchange = () => {
  localStorage.setItem('active_online_provider_id', provider.value)
  window.dispatchEvent(new Event('storage'))
}
updateLoginLabel()
const themePicker = document.createElement('select')
themePicker.setAttribute('aria-label', '预览主题')
for (const [value, text] of [
  ['dark', '深色主题'],
  ['light', '浅色主题'],
  ['blue', '蓝色主题'],
]) {
  const option = document.createElement('option')
  option.value = value
  option.textContent = text
  themePicker.append(option)
}
themePicker.onchange = () => setTheme(themePicker.value)
const languagePicker = document.createElement('select')
languagePicker.setAttribute('aria-label', 'Preview language')
for (const [value, text] of [
  ['zh-CN', '简体中文'],
  ['en', 'English'],
]) {
  const option = document.createElement('option')
  option.value = value
  option.textContent = text
  languagePicker.append(option)
}
languagePicker.onchange = () => setLocale(languagePicker.value)
previewBar.append(
  label,
  loginButton,
  provider,
  themePicker,
  languagePicker,
  roomButton,
  privateButton,
)
document.body.prepend(previewBar)
const previewSize = new ResizeObserver(() => {
  homeNode.style.height = `calc(100dvh - ${previewBar.getBoundingClientRect().height}px)`
})
previewSize.observe(previewBar)
panelNode.hidden = true
const register = (name) => ({
  register(def) {
    if (name === 'commands' && !def.label) throw new Error('Command requires label')
    if (name === 'playerPanelTabs') {
      panel = def
      roomButton.hidden = false
      panelNode.hidden = false
      mounted = def.mount(panelNode, context)
    }
    if (name === 'homeTabs') {
      home = def
      privateButton.hidden = false
    }
    return {
      unregister() {
        if (name === 'playerPanelTabs') {
          mounted?.()
          mounted = undefined
          panel = undefined
          panelNode.hidden = true
          roomButton.hidden = true
          queueNode.hidden = true
        }
        if (name === 'homeTabs') {
          homeMounted?.()
          homeMounted = undefined
          home = undefined
          homeNode.hidden = true
          privateButton.hidden = true
        }
      },
    }
  },
})
const folium = {
  env: { context: 'main' },
  experimental: {
    'playback.sessions': new URL(location.href).searchParams.has('unpatched')
      ? undefined
      : {
          version: 2,
          supportsHandoff: true,
          resolveSong: async (_, id) => ({
            id,
            source: 'netease',
            ref: id,
            title: id === '1' ? '晚风与海' : `下一站 · ${id}`,
            artist: '岛屿来信',
          }),
          acquire({ onIntent }) {
            intent = onIntent
            return {
              setQueue(value) {
                queue = value
                if (queueNode && !queueNode.hidden) renderQueue()
              },
              stop() {
                state.song = null
                state.state = 'stopped'
              },
              play: async (song) => {
                state.song = song
                state.duration = 30
                emit('playback.songChanged', { song })
                return { status: 'source-committed' }
              },
              seek: (seconds) => {
                state.position = seconds
              },
              handoff() {
                intent = undefined
                queue = undefined
                queueNode.hidden = true
              },
              release() {
                state.song = null
                state.state = 'stopped'
              },
            }
          },
        },
  },
  internals: {
    omni: {
      searchProviderSongs: async (provider, query) => {
        searchCalls.push({ provider, query })
        return {
          items: [
            {
              id: 20,
              name: '山海之间',
              artists: [{ name: '晚风' }],
              album: { name: '沿途' },
              sourceRef: { kind: 'online', providerId: 'netease', mediaId: '20' },
            },
          ],
          hasMore: false,
        }
      },
    },
  },
  events: {
    on(name, fn) {
      if (!events.has(name)) events.set(name, new Set())
      events.get(name).add(fn)
      return () => events.get(name).delete(fn)
    },
  },
  rpc: {
    async call(name, ...args) {
      const body = await fetch('/rpc', {
        method: 'POST',
        body: JSON.stringify({ name, args }),
      }).then((r) => r.json())
      if (!body.ok) throw new Error(body.error)
      return body.result
    },
  },
  playback: {
    getState: () => ({ ...state }),
    play() {
      state.state = 'playing'
      emit('playback.stateChanged', { state: 'playing' })
    },
    pause() {
      state.state = 'paused'
      emit('playback.stateChanged', { state: 'paused' })
    },
  },
  ui: {
    navigate() {},
    openPlayerPanel() {},
    openHomeTab() {
      panelNode.hidden = true
      queueNode.hidden = true
      homeNode.hidden = false
      homeMounted?.()
      homeNode.replaceChildren()
      homeMounted = home.mount(homeNode, context)
    },
    openQueue() {
      queueNode.hidden = false
      renderQueue()
    },
    toast(message, { type = 'info', durationMs = 2500 } = {}) {
      const toast = document.createElement('div')
      toast.textContent = message
      toast.setAttribute('role', type === 'error' ? 'alert' : 'status')
      toast.dataset.hostToast = type
      toast.style.cssText =
        'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 16px;border-radius:12px;background:#333;color:white;z-index:50;font:12px system-ui'
      document.body.append(toast)
      setTimeout(() => toast.remove(), durationMs)
    },
    async icon(name, options = {}) {
      const paths = {
        'refresh-cw': [
          'M3 12a9 9 0 0 1 15.36-6.36L21 8',
          'M21 3v5h-5',
          'M21 12a9 9 0 0 1-15.36 6.36L3 16',
          'M3 21v-5h5',
        ],
        'arrow-left': ['m12 19-7-7 7-7', 'M5 12h14'],
        x: ['M18 6 6 18', 'm6 6 12 12'],
        'arrow-up-to-line': ['M5 3h14', 'm18 13-6-6-6 6', 'M12 7v14'],
        'trash-2': ['M3 6h18', 'M19 6v14H5V6', 'M9 6V3h6v3', 'M10 10v6', 'M14 10v6'],
        'user-plus': [
          'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
          'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
          'M20 8v6',
          'M23 11h-6',
        ],
        'music-2': [
          'M9 18V5l12-2v13',
          'M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3',
          'M21 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3',
        ],
        'thumbs-up': ['M7 10v12H3V10z', 'M7 10l5-8a3 3 0 0 1 2 4l-1 4h6a2 2 0 0 1 2 2l-2 8H7'],
        'log-out': ['M9 21H3V3h6', 'm16 17 5-5-5-5', 'M21 12H9'],
        info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20', 'M12 11v6', 'M12 7h.01'],
        users: [
          'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
          'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
          'M22 21v-2a4 4 0 0 0-3-3.87',
        ],
      }
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      for (const [key, value] of Object.entries({
        viewBox: '0 0 24 24',
        width: options.size || 14,
        height: options.size || 14,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }))
        svg.setAttribute(key, String(value))
      for (const d of paths[name] || []) {
        const path = document.createElementNS(svg.namespaceURI, 'path')
        path.setAttribute('d', d)
        svg.append(path)
      }
      return svg
    },
  },
  registries: Object.fromEntries(
    ['playerPanelTabs', 'homeTabs', 'commands', 'controlButtons'].map((name) => [
      name,
      register(name),
    ]),
  ),
}
let homeMounted
const queueNode = document.createElement('div')
queueNode.id = 'native-queue'
queueNode.hidden = true
document.body.append(queueNode)
function renderQueue() {
  queueNode.replaceChildren()
  for (const entry of queue?.entries ?? []) {
    const row = document.createElement('div')
    row.className = 'native-queue-entry'
    row.dataset.entryId = entry.id
    row.textContent = entry.track.title
    for (const action of entry.actions) {
      const button = document.createElement('button')
      const label = action.label[context.locale] || action.label.en
      button.textContent = label
      button.setAttribute('aria-label', label)
      button.dataset.action = action.id
      if (action.count !== undefined) {
        const count = document.createElement('span')
        count.className = 'native-action-count'
        count.textContent = String(action.count)
        button.append(count)
      }
      button.disabled = action.disabled ?? false
      button.onclick = () =>
        intent({ type: 'queue-action', entryId: entry.id, actionId: action.id })
      row.append(button)
    }
    queueNode.append(row)
  }
}
privateButton.onclick = () => folium.ui.openHomeTab('private')
roomButton.onclick = () => {
  homeNode.hidden = true
  queueNode.hidden = true
  panelNode.hidden = false
}
const dispose = activate(folium)

window.partyTest = {
  openQueue: () => folium.ui.openQueue(),
  next: () => intent({ type: 'next' }),
  state,
  searchCalls,
  pause: () => folium.playback.pause(),
  play: () => folium.playback.play(),
  queue: () => queue,
  intent: (event) => intent(event),
  dispose() {
    previewSize.disconnect()
    mounted?.()
    homeMounted?.()
    dispose()
  },
}
