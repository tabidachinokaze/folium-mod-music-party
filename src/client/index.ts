import { mountPrivateHome } from './private-home'
import type { Folium } from './host'
import { PartyController } from './controller'
import { mountPanel } from './panel'

// src/client/index.ts
export default function activate(folium: Folium) {
  if (folium.env.context !== 'main') return
  const controller = new PartyController(folium)
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
            mount: (container: HTMLElement) => mountPrivateHome(container, controller),
          }),
        ]
      : []),
    folium.registries.playerPanelTabs.register({
      id: 'room',
      label: { 'zh-CN': '一起听', en: 'Music Party' },
      order: 200,
      mount: (container: HTMLElement) => mountPanel(container, controller),
    }),
    folium.registries.commands.register({
      id: 'open',
      label: { 'zh-CN': '打开网易云多人一起听', en: 'Open Music Party' },
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
        button.title = '网易云多人一起听'
        button.setAttribute('aria-label', button.title)
        button.style.cssText =
          'display:grid;place-items:center;width:24px;height:24px;color:inherit;cursor:pointer;background:transparent;border:0'
        button.append(folium.ui.icon('users', { size: 18 }))
        button.onclick = open
        container.append(button)
        const stop = controller.subscribe(() => {
          button.style.color = controller.state.room ? '#a3e7c2' : 'inherit'
        })
        return () => {
          stop()
          button.remove()
        }
      },
    }),
  ]
  const online = () => {
    if (controller.state.room) void controller.refresh()
  }
  window.addEventListener('online', online)
  window.addEventListener('focus', online)
  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('focus', online)
    controller.dispose()
    handles.forEach((handle) => handle.unregister())
  }
}
