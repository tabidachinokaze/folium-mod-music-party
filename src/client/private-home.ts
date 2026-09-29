import styles from './panel.css'
import type { PartyController } from './controller'
import { button, el } from './dom'
import { mountPrivate } from './private-view'

// src/client/private-home.ts
export function mountPrivateHome(container: HTMLElement, controller: PartyController) {
  const host = el('div', 'mp-private-host')
  host.style.cssText = 'height:100%;min-height:0;overflow:hidden'
  container.append(host)
  const root = host.attachShadow({ mode: 'open' }),
    css = el('style')
  css.textContent = styles
  const page = el('div', 'mp mp-private-home'),
    header = el('header', 'mp-header')
  const feedback = el('div', 'mp-private-feedback')
  feedback.hidden = true
  const report = (text: string, error = false) => {
    feedback.textContent = text
    feedback.hidden = !text
    feedback.setAttribute('role', error ? 'alert' : 'status')
    feedback.classList.toggle('mp-error', error)
  }
  const connect = button('连接网易云账号', () => {
    void controller.connect().catch((error) => report(error.message, true))
  })
  const body = el('section', 'mp-private-layout')
  body.setAttribute('aria-label', '私信会话')
  const view = mountPrivate(body, controller, report)
  header.append(el('h2', '', '私信'), connect, view.refreshButton)
  page.append(header, feedback, body)
  root.append(css, page)
  let accountUid: string | null = null
  const render = () => {
    const uid = controller.state.account?.uid ?? null
    body.hidden = !uid
    connect.hidden = Boolean(uid)
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
    host.remove()
  }
}
