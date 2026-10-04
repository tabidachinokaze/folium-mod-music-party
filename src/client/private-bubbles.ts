import type { FoliumStageContext } from '../../vendor/folium/contract'
import type { Conversation } from '@party/shared/types'
import type { PartyController } from './controller'
import { button, el, picture } from './dom'
import { t } from './i18n'
import { mountSurface } from './surface'
import { mountPrivate } from './private-view'
import { getPrivatePresence } from './private-presence'
import { PrivateBubbleInbox } from './private-bubble-inbox'
import { mountPrivateBubbleGeometry } from './private-bubble-geometry'
import { privateConversationVisible, subscribePrivateRead } from './private-view-activity'
import { dismissTopPopup } from './popup-position'
import styles from './private-bubbles.css'

type View = { body: HTMLElement; view: ReturnType<typeof mountPrivate> }
type Toast = {
  node: HTMLElement
  avatar: HTMLElement
  name: HTMLElement
  preview: HTMLElement
  open: HTMLButtonElement
  timer?: ReturnType<typeof setTimeout>
  remaining: number
  started: number
}

/** One account's player inbox survives stage remounts and song changes. */
export function createPrivateBubbles(controller: PartyController) {
  const parking = el('div'),
    surface = mountSurface(parking, 'mp-private-notifications'),
    css = el('style'),
    rail = el('div', 'mp-private-bubble-rail'),
    toastList = el('div', 'mp-private-toast-list'),
    dialog = el('section', 'mp-private-bubble-dialog'),
    inbox = new PrivateBubbleInbox(),
    presence = getPrivatePresence(controller),
    views = new Map<string, View>(),
    toasts = new Map<string, Toast>()
  let stage: { container: HTMLElement; context: FoliumStageContext; stop(): void } | null = null,
    geometry: ReturnType<typeof mountPrivateBubbleGeometry> | null = null,
    expanded: string | null = null,
    disposed = false,
    visible = false,
    presenting = false,
    hovering = false,
    opening: string | null = null,
    account = controller.state.account?.uid ?? ''
  css.textContent = styles
  surface.root.append(css)
  surface.host.style.cssText =
    'position:absolute;inset:0;pointer-events:none;min-width:0;min-height:0'
  surface.page.append(toastList, dialog, rail)
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'false')
  rail.setAttribute('aria-label', t('私信气泡'))
  toastList.setAttribute('aria-live', 'polite')
  toastList.setAttribute('aria-relevant', 'additions text')
  dialog.hidden = true

  function resolved(uid: string): Conversation | undefined {
    const peer = inbox.conversations.get(uid)
    if (!peer) return
    const cached = presence.get(uid)
    return {
      ...peer,
      nickname: cached?.nickname || peer.nickname,
      avatar: cached?.avatar || peer.avatar,
    }
  }
  function avatar(node: HTMLElement, peer: Conversation) {
    node.replaceChildren(el('span', 'mp-dm-initial', peer.nickname.slice(0, 1)))
    if (peer.avatar) node.append(picture(peer.avatar, ''))
    if (presence.get(peer.uid)?.online === true) {
      const dot = el('span', 'mp-presence-dot')
      dot.setAttribute('role', 'img')
      dot.setAttribute('aria-label', t('在线'))
      dot.title = t('在线')
      node.append(dot)
    }
  }
  function renderRail() {
    const focused =
      surface.root.activeElement instanceof HTMLElement
        ? surface.root.activeElement.dataset.peerUid
        : undefined
    const peers = [...inbox.conversations.values()].reverse()
    rail.replaceChildren(
      ...peers.map((item) => {
        const peer = resolved(item.uid)!
        const pick = button('', () => void open(peer.uid), 'mp-private-bubble')
        pick.dataset.peerUid = peer.uid
        pick.title = peer.nickname
        pick.setAttribute('aria-label', t('与{name}对话', { name: peer.nickname }))
        pick.setAttribute('aria-expanded', String(expanded === peer.uid))
        avatar(pick, peer)
        if (peer.unread) {
          const badge = el('span', 'mp-dm-unread', peer.unread > 99 ? '99+' : String(peer.unread))
          badge.setAttribute('aria-label', t('{count} 条未读私信', { count: peer.unread }))
          badge.id = `mp-dm-unread-${peer.uid}`
          pick.setAttribute('aria-describedby', badge.id)
          pick.append(badge)
        }
        return pick
      }),
    )
    if (focused)
      rail
        .querySelector<HTMLButtonElement>(`[data-peer-uid="${focused}"]`)
        ?.focus({ preventScroll: true })
    rail.hidden = !peers.length
  }
  function removeToast(uid: string) {
    const toast = toasts.get(uid)
    if (!toast) return
    clearTimeout(toast.timer)
    toast.node.remove()
    toasts.delete(uid)
    geometry?.refresh()
  }
  function clearToasts() {
    for (const uid of toasts.keys()) removeToast(uid)
  }
  function resumeToast(uid: string) {
    const toast = toasts.get(uid)
    if (!toast || toast.node.matches(':hover') || toast.node.matches(':focus-within')) return
    clearTimeout(toast.timer)
    toast.started = Date.now()
    toast.timer = setTimeout(() => removeToast(uid), toast.remaining)
  }
  function pauseToast(uid: string) {
    const toast = toasts.get(uid)
    if (!toast) return
    clearTimeout(toast.timer)
    toast.remaining = Math.max(0, toast.remaining - (Date.now() - toast.started))
  }
  function renderToast(uid: string) {
    const toast = toasts.get(uid),
      peer = resolved(uid)
    if (!toast || !peer) return
    avatar(toast.avatar, peer)
    toast.name.textContent = peer.nickname
    toast.preview.textContent = peer.preview
    toast.open.setAttribute('aria-label', t('回复 {name}', { name: peer.nickname }))
  }
  function showToast(uid: string) {
    if (expanded && surface.page.getBoundingClientRect().height < 520) return
    let toast = toasts.get(uid)
    if (!toast) {
      const node = el('div', 'mp-private-toast'),
        portrait = el('span', 'mp-dm-avatar'),
        info = el('span', 'mp-dm-toast-info'),
        name = el('strong'),
        preview = el('span'),
        pick = button('', () => void open(uid), 'mp-dm-toast-open'),
        dismiss = control('关闭通知', 'x', () => removeToast(uid))
      info.append(name, preview)
      pick.append(portrait, info)
      node.append(pick, dismiss)
      toast = {
        node,
        avatar: portrait,
        name,
        preview,
        open: pick,
        remaining: 8000,
        started: Date.now(),
      }
      toasts.set(uid, toast)
      node.addEventListener('pointerenter', () => pauseToast(uid))
      node.addEventListener('pointerleave', () => resumeToast(uid))
      node.addEventListener('focusin', () => pauseToast(uid))
      node.addEventListener('focusout', () => queueMicrotask(() => resumeToast(uid)))
      toastList.append(node)
    }
    toast.remaining = 8000
    toast.started = Date.now()
    renderToast(uid)
    resumeToast(uid)
    while (toasts.size > (expanded ? 1 : 3)) removeToast(toasts.keys().next().value!)
    geometry?.refresh()
  }
  function control(label: string, icon: string, action: () => void) {
    const node = button('', action, 'mp-dm-control')
    node.title = t(label)
    node.setAttribute('aria-label', t(label))
    node.textContent = icon === 'x' ? '×' : '−'
    void controller.folium.ui
      .icon(icon, { size: 16 })
      .then((svg) => {
        if (svg) {
          svg.setAttribute('aria-hidden', 'true')
          node.replaceChildren(svg)
        }
      })
      .catch(() => {})
    return node
  }
  function minimize(focus = false) {
    const uid = expanded
    expanded = null
    opening = null
    surface.page.dataset.dialogOpen = 'false'
    if (uid) views.get(uid)?.view.hide()
    dialog.hidden = true
    renderRail()
    geometry?.refresh()
    if (focus && uid)
      rail
        .querySelector<HTMLButtonElement>(`[data-peer-uid="${uid}"]`)
        ?.focus({ preventScroll: true })
    sync()
  }
  function close(uid: string) {
    if (expanded === uid) minimize()
    const entry = views.get(uid)
    entry?.view.dispose()
    entry?.body.remove()
    views.delete(uid)
    inbox.conversations.delete(uid)
    removeToast(uid)
    renderRail()
  }
  async function open(uid: string) {
    if (!visible || disposed) return
    const peer = resolved(uid)
    if (!peer) return
    if (expanded !== uid) minimize()
    let entry = views.get(uid)
    if (!entry) {
      // Evict only an idle, empty editor; never silently throw away a draft or open attachment.
      if (views.size >= 5) {
        const idle = [...views].find(
          ([id, value]) =>
            id !== expanded &&
            !value.body.querySelector<HTMLTextAreaElement>('textarea')?.disabled &&
            !value.body.querySelector<HTMLTextAreaElement>('textarea')?.value.trim() &&
            !value.body.querySelector('dialog[open], :popover-open, details[open]'),
        )
        if (idle) {
          idle[1].view.dispose()
          idle[1].body.remove()
          views.delete(idle[0])
        } else {
          controller.notify(t('请先关闭一个对话气泡，再打开新的对话'), 'info')
          return
        }
      }
      const body = el('div', 'mp-private-bubble-body')
      dialog.append(body)
      const view = mountPrivate(
        body,
        controller,
        (text, error) => {
          if (text) controller.notify(text, error ? 'error' : 'success')
        },
        { conversationOnly: true, isVisible: () => visible && expanded === uid },
      )
      const heading = body.querySelector('.mp-conversation-header')!
      heading.append(
        control('收起对话', 'minus', () => minimize(true)),
        control('关闭对话', 'x', () => close(uid)),
      )
      entry = { body, view }
      views.set(uid, entry)
    }
    expanded = uid
    opening = uid
    surface.page.dataset.dialogOpen = 'true'
    for (const [id, value] of views) value.body.hidden = id !== uid
    dialog.hidden = false
    dialog.setAttribute('aria-label', t('与{name}对话', { name: peer.nickname }))
    removeToast(uid)
    while (toasts.size > 1) removeToast(toasts.keys().next().value!)
    geometry?.refresh()
    renderRail()
    entry.view.show()
    sync()
    await entry.view.open(peer)
    if (!disposed && expanded === uid && visible) entry.view.focus()
    if (opening === uid) opening = null
    sync()
  }
  function reset() {
    expanded = null
    opening = null
    hovering = false
    surface.page.dataset.dialogOpen = 'false'
    for (const entry of views.values()) {
      entry.view.dispose()
      entry.body.remove()
    }
    views.clear()
    clearToasts()
    inbox.reset()
    dialog.hidden = true
    renderRail()
  }
  function sync() {
    if (disposed) return
    const uid = controller.state.account?.uid ?? ''
    if (uid !== account) {
      account = uid
      reset()
    }
    const display = stage?.context.getDisplay()
    const next =
      !!account &&
      !!stage &&
      !!display?.showText &&
      !stage.context.staticMode &&
      !stage.context.isPreview &&
      document.visibilityState === 'visible'
    const changed = visible !== next
    visible = next
    surface.page.hidden = !visible
    const focused = surface.root.activeElement,
      heldOpen =
        hovering ||
        !!opening ||
        (!!focused && (rail.contains(focused) || dialog.contains(focused))) ||
        !!surface.page.querySelector(':popover-open'),
      controlsVisible = visible && (!display?.isPlayerChromeHidden || heldOpen),
      presentationChanged = presenting !== controlsVisible
    presenting = controlsVisible
    for (const node of [rail, dialog]) {
      const shown = controlsVisible && (node === rail || !!expanded)
      node.dataset.visible = String(shown)
      node.inert = !shown
      node.setAttribute('aria-hidden', String(!shown))
    }
    if (!visible) {
      clearToasts()
      hovering = false
    }
    if ((changed || presentationChanged) && expanded) {
      if (controlsVisible) views.get(expanded)?.view.show()
      else views.get(expanded)?.view.hide()
    }
    if (stage)
      surface.host.style.colorScheme = stage.context.getTheme().isDaylight ? 'light' : 'dark'
    for (const entry of views.values()) entry.view.update()
    geometry?.refresh()
    presenceWatch.refresh()
  }
  const presenceWatch = presence.watch({
    peers: () => {
      const peers = new Set([...(expanded ? [expanded] : []), ...toasts.keys()])
      const bounds = rail.getBoundingClientRect()
      for (const pick of rail.querySelectorAll<HTMLElement>('[data-peer-uid]')) {
        const rect = pick.getBoundingClientRect()
        if (rect.width > 0 && rect.right > bounds.left && rect.left < bounds.right)
          peers.add(pick.dataset.peerUid!)
      }
      return [...peers]
    },
    active: () => visible,
    changed: () => {
      renderRail()
      for (const uid of toasts.keys()) renderToast(uid)
    },
  })
  rail.addEventListener('scroll', () => presenceWatch.refresh(), { passive: true })
  const stopRead = subscribePrivateRead(controller, (uid, boundary) => {
    if (inbox.read(uid, boundary)) removeToast(uid)
    renderRail()
  })
  const stopNotifications = controller.privateNotifications.subscribe((notice) => {
    if (disposed || !account) return
    const peer = inbox.receive(notice, account, views.keys())
    if (!peer) return
    renderRail()
    if (visible && document.hasFocus() && !privateConversationVisible(controller, peer.uid))
      showToast(peer.uid)
    presenceWatch.refresh()
  })
  const stopState = controller.subscribe(sync)
  for (const node of [rail, dialog]) {
    node.addEventListener('pointerenter', () => {
      hovering = true
      sync()
    })
    node.addEventListener('pointerleave', () => {
      hovering = false
      sync()
    })
    node.addEventListener('focusin', sync)
    node.addEventListener('focusout', () => queueMicrotask(sync))
  }
  surface.page.addEventListener('toggle', () => queueMicrotask(sync), true)
  dialog.addEventListener('keydown', (event) => {
    // Let a picker or native choice modal consume Escape before collapsing the conversation.
    if (event.key === 'Escape') {
      if (dialog.querySelector(':popover-open') && dismissTopPopup(dialog.ownerDocument))
        event.preventDefault()
      else if (!dialog.querySelector('dialog[open], details[open]')) {
        event.preventDefault()
        minimize(true)
      }
    }
    event.stopPropagation()
  })
  const wake = () => sync()
  document.addEventListener('visibilitychange', wake)
  window.addEventListener('focus', wake)
  window.addEventListener('blur', wake)
  sync()
  return {
    mountStage(container: HTMLElement, context: FoliumStageContext) {
      stage?.stop()
      geometry?.dispose()
      const mounted = { container, context, stop: context.subscribe(sync) }
      stage = mounted
      container.append(surface.host)
      geometry = mountPrivateBubbleGeometry(
        surface.page,
        () => !!stage?.context.getDisplay().isPanelOpen,
        () => !!expanded && toasts.size > 0,
      )
      sync()
      return () => {
        mounted.stop()
        if (stage !== mounted) return
        stage = null
        geometry?.dispose()
        geometry = null
        parking.append(surface.host)
        sync()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stage?.stop()
      geometry?.dispose()
      stopNotifications()
      stopRead()
      stopState()
      presenceWatch.dispose()
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
      window.removeEventListener('blur', wake)
      reset()
      surface.dispose()
    },
  }
}
