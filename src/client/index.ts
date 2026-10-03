import type { FoliumPanelContext } from '../../vendor/folium/contract'
import { mountPrivateHome } from './private-home'
import { activeNeteaseSession, type Folium } from './host'
import { PartyController } from './controller'
import { mountPanel } from './panel'
import { setLocale, t } from './i18n'
import { createPartyIcon, partyIconPaths } from './party-icon'

// src/client/index.ts
function registerEntries(folium: Folium, controller: PartyController) {
  const open = () => {
    folium.ui.navigate('player')
    folium.ui.openPlayerPanel('room')
  }
  const handles = [
    ...(folium.registries.homeTabs
      ? [
          folium.registries.homeTabs.register({
            id: 'private',
            label: { 'zh-CN': '私信', en: 'Messages' },
            order: 200,
            mount: (container: HTMLElement, context: FoliumPanelContext) =>
              mountPrivateHome(container, controller, context),
          }),
        ]
      : []),
    folium.registries.playerPanelTabs.register({
      id: 'room',
      label: { 'zh-CN': '一起听', en: 'Music Party' },
      icon: 'users',
      iconPaths: partyIconPaths,
      order: 200,
      mount: (container: HTMLElement, context: FoliumPanelContext) =>
        mountPanel(container, controller, context),
    }),
    folium.registries.commands.register({
      id: 'open',
      label: { 'zh-CN': '打开网易云多人一起听', en: 'Open Music Party' },
      icon: 'users',
      iconPaths: partyIconPaths,
      run: open,
    }),
    folium.registries.controlButtons.register({
      id: 'room',
      slot: 'progress.trailing',
      order: 490,
      hideWhenCollapsed: true,
      mount: (container: HTMLElement) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.title = t('网易云多人一起听')
        button.setAttribute('aria-label', button.title)
        button.style.cssText =
          'display:grid;place-items:center;width:24px;height:24px;color:inherit;cursor:pointer;background:transparent;border:0'
        button.append(createPartyIcon())
        button.onclick = open
        container.append(button)
        const render = () => {
          button.title = t('网易云多人一起听')
          button.setAttribute('aria-label', button.title)
          button.style.color = controller.state.room
            ? 'var(--folium-accent, currentColor)'
            : 'inherit'
          button.setAttribute('aria-pressed', String(!!controller.state.room))
        }
        const stop = controller.subscribe(render)
        const language = new MutationObserver(render)
        language.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
        render()
        return () => {
          stop()
          language.disconnect()
          button.remove()
        }
      },
    }),
  ]
  const online = () => {
    if (!controller.state.account) return
    if (controller.state.room) void controller.refresh()
    else if (!controller.state.busy && !controller.state.matching && !controller.state.checkingRoom)
      void controller.checkAvailableRoom()
  }
  window.addEventListener('online', online)
  window.addEventListener('focus', online)
  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('focus', online)
    handles.forEach((handle) => handle.unregister())
  }
}

// Registration follows the selected provider and verified account, including same-window changes.
export default function activate(folium: Folium) {
  if (folium.env.context !== 'main') return
  setLocale(document.documentElement.lang || 'zh-CN')
  let session = '',
    controller: PartyController | null = null,
    unregister: (() => void) | undefined
  let disposed = false,
    connecting = false,
    generation = 0,
    retryAt = 0,
    failures = 0
  const reset = () => {
    generation++
    unregister?.()
    unregister = undefined
    controller?.dispose()
    controller = null
    connecting = false
  }
  const sync = async () => {
    if (disposed) return
    const next = activeNeteaseSession()
    if (next !== session) {
      reset()
      session = next
      retryAt = 0
      failures = 0
    }
    if (!next) return
    if (unregister && controller?.state.account) return
    if (unregister) {
      reset()
      retryAt = Date.now() + 5000
    }
    if (connecting || Date.now() < retryAt) return
    connecting = true
    const mine = generation
    const candidate = controller || new PartyController(folium)
    controller = candidate
    try {
      await candidate.connect()
      if (disposed || mine !== generation || activeNeteaseSession() !== session) return
      if (!candidate.state.account) {
        retryAt = Date.now() + 5000
        return
      }
      unregister = registerEntries(folium, candidate)
      failures = 0
    } catch {
      if (mine === generation) retryAt = Date.now() + Math.min(30000, 5000 * ++failures)
    } finally {
      if (mine === generation) connecting = false
    }
  }
  const update = () => void sync()
  const timer = window.setInterval(update, 750)
  window.addEventListener('storage', update)
  window.addEventListener('focus', update)
  window.addEventListener('online', update)
  update()
  return () => {
    disposed = true
    window.clearInterval(timer)
    window.removeEventListener('storage', update)
    window.removeEventListener('focus', update)
    window.removeEventListener('online', update)
    reset()
  }
}
