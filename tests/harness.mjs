import activate from '/client.mjs'

// tests/harness.mjs
localStorage.setItem('online_provider:netease:cookie', 'MUSIC_U=test-only')
window.electron = { getNeteasePort: async () => 4176 }
const events = new Map(),
  state = {
    song: { id: '1', source: 'netease', ref: '1', title: '晚风与海', artist: '岛屿来信' },
    state: 'playing',
    duration: 30,
    position: 5,
  }
const emit = (name, value) => events.get(name)?.forEach((fn) => fn(value))
let panel, home, mounted, intent, queue
const panelNode = document.querySelector('#panel')
const homeNode = document.createElement('div')
homeNode.id = 'private-home'
homeNode.hidden = true
document.body.append(homeNode)
const privateButton = document.createElement('button')
privateButton.textContent = '私信'
document.body.prepend(privateButton)
const register = (name) => ({
  register(def) {
    if (name === 'commands' && !def.label) throw new Error('Command requires label')
    if (name === 'playerPanelTabs') panel = def
    if (name === 'homeTabs') home = def
    return { unregister() {} }
  },
})
const folium = {
  env: { context: 'main' },
  experimental: {
    'playback.sessions': new URL(location.href).searchParams.has('unpatched')
      ? undefined
      : {
          version: 2,
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
      searchProviderSongs: async () => ({
        items: [{ id: 20, name: '山海之间', artists: [{ name: '晚风' }] }],
      }),
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
      homeMounted = home.mount(homeNode)
    },
    openQueue() {
      queueNode.hidden = false
      renderQueue()
    },
    toast() {},
    icon: () => document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
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
    row.textContent = entry.track.title
    for (const action of entry.actions) {
      const button = document.createElement('button')
      button.textContent = action.label['zh-CN']
      button.disabled = action.disabled ?? false
      button.onclick = () =>
        intent({ type: 'queue-action', entryId: entry.id, actionId: action.id })
      row.append(button)
    }
    queueNode.append(row)
  }
}
privateButton.onclick = () => folium.ui.openHomeTab('private')
const dispose = activate(folium)
mounted = panel.mount(document.querySelector('#panel'))
window.partyTest = {
  openQueue: () => folium.ui.openQueue(),
  next: () => intent({ type: 'next' }),
  state,
  queue: () => queue,
  intent: (event) => intent(event),
  dispose() {
    mounted()
    homeMounted?.()
    dispose()
  },
}
