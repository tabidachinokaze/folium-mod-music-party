import { mountSurface } from './surface'
import type { FoliumPanelContext } from '../../vendor/folium/contract'
import type { PartyController } from './controller'
import { el } from './dom'
import { mountPrivate } from './private-view'

// src/client/private-home.ts
export function mountPrivateHome(
  container: HTMLElement,
  controller: PartyController,
  context?: FoliumPanelContext,
) {
  const { page, dispose: disposeSurface } = mountSurface(container, 'mp-private-home', context)
  const header = el('header', 'mp-header')
  const report = (text: string, error = false) =>
    controller.notify(text, error ? 'error' : 'success')
  const body = el('section', 'mp-private-layout')
  body.setAttribute('aria-label', '私信会话')
  const view = mountPrivate(body, controller, report)
  header.append(el('h2', '', '私信'), view.refreshButton)
  page.append(header, body)
  let accountUid: string | null = null
  const render = () => {
    const uid = controller.state.account?.uid ?? null
    body.hidden = !uid
    page.hidden = !uid
    view.refreshButton.hidden = !uid
    if (accountUid !== uid) {
      view.reset()
      report('')
      accountUid = uid
      if (uid) view.show()
    }
    view.update()
  }
  const stop = controller.subscribe(render)
  render()
  return () => {
    stop()
    view.dispose()
    disposeSurface()
  }
}
