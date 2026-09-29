import styles from './panel.css'
import type { PartyController } from './controller'
import { button, el } from './dom'
import { mountPrivate } from './private-view'

// src/client/private-home.ts
export function mountPrivateHome(container: HTMLElement, controller: PartyController) {
  const host = el('div')
  container.append(host)
  const root = host.attachShadow({ mode: 'open' }),
    css = el('style')
  css.textContent = styles
  const page = el('div', 'mp mp-private-home'),
    header = el('header', 'mp-header')
  const account = el('span', 'mp-muted')
  const connect = button(
    '连接网易云账号',
    () => void controller.run(() => controller.connect()),
    'mp-command',
  )
  header.append(el('h2', '', '私信'), account, connect)
  const error = el('div', 'mp-error'),
    notice = el('div', 'mp-notice'),
    body = el('section', 'mp-private-layout')
  error.setAttribute('role', 'alert')
  notice.setAttribute('role', 'status')
  body.setAttribute('aria-label', '私信会话')
  page.append(header, error, notice, body)
  root.append(css, page)
  const view = mountPrivate(body, controller)
  let accountUid: string | null = null
  function render() {
    const state = controller.state
    error.textContent = state.error
    error.hidden = !state.error
    notice.textContent = state.notice
    notice.hidden = !state.notice
    body.hidden = !state.account
    account.textContent = state.account ? state.account.nickname : '复用 Folia 中已登录的网易云账号'
    connect.hidden = Boolean(state.room)
    connect.textContent = state.account ? '重新连接账号' : '连接网易云账号'
    root.querySelectorAll<HTMLButtonElement>('.mp-command').forEach((button) => {
      button.disabled = state.busy
    })
    if (accountUid !== (state.account?.uid ?? null)) {
      view.reset()
      accountUid = null
    }
    if (state.account && !state.busy && !accountUid) {
      accountUid = state.account.uid
      view.show()
    }
  }
  const stop = controller.subscribe(render)
  render()
  return () => {
    stop()
    view.dispose()
    host.remove()
  }
}
