import type { FoliumPanelContext } from '../../vendor/folium/contract'
import base from './surface.css'
import panel from './panel.css'
import messages from './messages.css'
import pickers from './pickers.css'
import privatePage from './private.css'
import { el } from './dom'

// src/client/surface.ts
// The host owns outer spacing, font resolution and color variables. Shadow DOM only isolates rules.
export function mountSurface(
  container: HTMLElement,
  className: string,
  context?: FoliumPanelContext,
) {
  const host = el('div')
  host.style.cssText =
    className === 'mp-private-home' ? 'height:100%;min-height:0;overflow:hidden' : 'min-width:0'
  container.append(host)
  const root = host.attachShadow({ mode: 'open' })
  const css = el('style')
  css.textContent = [base, panel, messages, pickers, privatePage].join('\n')
  const page = el('div', `mp ${className}`)
  root.append(css, page)
  const syncTheme = () => {
    const theme = context?.getTheme()
    if (theme) host.style.colorScheme = theme.isDaylight ? 'light' : 'dark'
  }
  syncTheme()
  const unsubscribe = context?.subscribe(syncTheme)
  return {
    host,
    root,
    page,
    dispose() {
      unsubscribe?.()
      host.remove()
    },
  }
}
