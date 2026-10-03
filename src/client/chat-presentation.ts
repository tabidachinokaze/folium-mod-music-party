import type { FoliumStageContext } from '../../vendor/folium/contract'
import type { ChatMessage } from '@party/shared/types'
import type { PartyController } from './controller'
import type { ChatPreferences } from './chat-preferences'
import { ChatMessageFeed } from './chat-message-feed'
import { mountDanmaku } from './chat-danmaku'
import { mountChatOverlayGeometry } from './chat-overlay-geometry'
import { mountRoomChat } from './room-chat'
import { mountSurface } from './surface'
import { decorateRoomMessage } from './room-message'
import { el, messageNode } from './dom'
import { getLocale, t } from './i18n'
import styles from './chat-presentation.css'

// src/client/chat-presentation.ts
// One chat instance outlives native panel/stage mounts, preserving drafts and loaded media.
export function createChatPresentation(controller: PartyController, prefs: ChatPreferences) {
  const parking = el('div'),
    surface = mountSurface(parking, 'mp-chat-presentation'),
    css = el('style'),
    full = el('section', 'mp-floating-chat'),
    peeks = el('div', 'mp-chat-peeks'),
    danmakuNode = el('div'),
    chatNode = el('div', 'mp-chat-view')
  css.textContent = styles
  surface.root.append(css)
  surface.host.style.cssText =
    'position:absolute;inset:0;pointer-events:none;min-width:0;min-height:0'
  surface.page.append(full, peeks, danmakuNode)
  full.append(chatNode)
  full.setAttribute('aria-label', t('悬浮聊天'))
  peeks.setAttribute('role', 'log')
  peeks.setAttribute('aria-live', 'polite')
  const danmaku = mountDanmaku(danmakuNode, controller),
    feed = new ChatMessageFeed(),
    pendingPeeks = new Map<HTMLElement, number>()
  let chat = mountRoomChat(chatNode, controller),
    locale = getLocale(),
    panel: { container: HTMLElement; visible: boolean } | null = null,
    stage: { container: HTMLElement; context: FoliumStageContext; stop: () => void } | null = null,
    stopGeometry: (() => void) | null = null,
    disposed = false,
    hovering = false,
    showingChat = false,
    showingFull = false,
    previousScope = ''

  function clearPeeks() {
    if (!pendingPeeks.size) return
    for (const timer of pendingPeeks.values()) clearTimeout(timer)
    pendingPeeks.clear()
    peeks.replaceChildren()
  }
  function closePopups() {
    chat.show(false)
    showingChat = false
    for (const box of chatNode.querySelectorAll<HTMLDetailsElement>('details[open]'))
      box.open = false
    for (const popup of chatNode.querySelectorAll<HTMLElement>(':popover-open')) popup.hidePopover()
  }
  function refreshLocale() {
    if (locale === getLocale()) return
    locale = getLocale()
    const draft = chatNode.querySelector('textarea')?.value || '',
      scroll = chat.getScrollState()
    closePopups()
    chat.dispose()
    chatNode.replaceChildren()
    chat = mountRoomChat(chatNode, controller)
    const textarea = chatNode.querySelector('textarea')
    if (textarea) textarea.value = draft
    chat.restoreScrollState(scroll)
    full.setAttribute('aria-label', t('悬浮聊天'))
    clearPeeks()
  }
  function hasFocus() {
    const root = chatNode.getRootNode()
    return (
      (root instanceof ShadowRoot || root instanceof Document) &&
      !!root.activeElement &&
      chatNode.contains(root.activeElement)
    )
  }
  function heldOpen() {
    return hovering || hasFocus() || !!chatNode.querySelector(':popover-open')
  }
  function showPeek(message: ChatMessage) {
    const item = el('div', 'mp-chat-peek'),
      row = messageNode(
        message,
        message.uid === controller.state.account?.uid,
        controller.folium.ui,
      )
    item.dataset.messageId = message.id
    decorateRoomMessage(
      row,
      {
        ...message,
        avatar:
          message.avatar ||
          controller.state.room?.members.find((member) => member.uid === message.uid)?.avatar ||
          '',
      },
      controller.state.account?.nickname || '',
      () => {},
    )
    // Peeks announce the message but cannot start media or steal the composer's focus.
    for (const media of row.querySelectorAll('video,audio')) media.removeAttribute('controls')
    for (const control of row.querySelectorAll<HTMLElement>(
      'button,a,input,textarea,select,audio,video,[tabindex]',
    ))
      control.tabIndex = -1
    item.append(row)
    peeks.append(item)
    const leave = () => {
      item.dataset.leaving = 'true'
      pendingPeeks.set(
        item,
        window.setTimeout(() => {
          pendingPeeks.delete(item)
          item.remove()
        }, 260),
      )
    }
    pendingPeeks.set(item, window.setTimeout(leave, prefs.get().peekSeconds * 1000))
    while (pendingPeeks.size > 3) {
      const [old, timer] = pendingPeeks.entries().next().value!
      clearTimeout(timer)
      pendingPeeks.delete(old)
      old.remove()
    }
  }
  function sync() {
    if (disposed) return
    refreshLocale()
    const settings = prefs.get(),
      state = controller.state,
      display = stage?.context.getDisplay(),
      scope = state.account && state.room ? `${state.account.uid}:${state.room.roomId}` : '',
      activeStage = !!stage && !!display?.showText && !!scope,
      floating = settings.position === 'bottom-left',
      fullVisible = activeStage && floating && (!display?.isPlayerChromeHidden || heldOpen()),
      peekActive = activeStage && floating && !fullVisible,
      parent = floating ? full : panel?.container || parking

    if (scope !== previousScope) {
      previousScope = scope
      hovering = false
      clearPeeks()
      closePopups()
    }
    if (chatNode.parentElement !== parent) {
      closePopups()
      hovering = false
      parent.append(chatNode)
    }
    surface.page.hidden = !activeStage
    full.hidden = !floating
    if (showingFull !== fullVisible) {
      showingFull = fullVisible
      if (fullVisible) clearPeeks()
    }
    full.dataset.visible = String(fullVisible)
    full.inert = !fullVisible
    full.setAttribute('aria-hidden', String(!fullVisible))
    peeks.hidden = !peekActive
    if (!activeStage || !floating) clearPeeks()
    const visible = floating ? fullVisible : !!scope && !!panel?.visible
    if (showingChat !== visible) {
      if (!visible) closePopups()
      else {
        chat.show(true, true)
        showingChat = true
      }
    }
    if (stage)
      surface.host.style.colorScheme = stage.context.getTheme().isDaylight ? 'light' : 'dark'
    if (activeStage && floating && !stopGeometry)
      stopGeometry = mountChatOverlayGeometry(surface.page)
    else if ((!activeStage || !floating) && stopGeometry) {
      stopGeometry()
      stopGeometry = null
    }
    danmaku.setEnabled(settings.danmaku)
    danmaku.setVisible(activeStage)
    for (const message of feed.take(state, peekActive)) showPeek(message)
  }
  const stopState = controller.subscribe(sync),
    stopPreferences = prefs.subscribe(sync),
    language = new MutationObserver(sync),
    popups = new MutationObserver(sync)
  language.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  popups.observe(chatNode, { attributes: true, subtree: true, attributeFilter: ['open'] })
  full.addEventListener('pointerenter', () => {
    hovering = true
    sync()
  })
  full.addEventListener('pointerleave', () => {
    hovering = false
    sync()
  })
  chatNode.addEventListener('focusin', sync)
  chatNode.addEventListener('focusout', () => queueMicrotask(sync))
  // Manual context menus are popovers rather than details; toggle is not a bubbling event.
  chatNode.addEventListener('toggle', () => queueMicrotask(sync), true)
  sync()
  return {
    mountPanel(container: HTMLElement) {
      const mount = { container, visible: false }
      panel = mount
      sync()
      return {
        show(visible: boolean) {
          if (panel !== mount || disposed) return
          mount.visible = visible
          sync()
        },
        dispose() {
          if (panel !== mount) return
          panel = null
          sync()
        },
      }
    },
    mountStage(container: HTMLElement, context: FoliumStageContext) {
      stage?.stop()
      const mount = { container, context, stop: context.subscribe(sync) }
      stage = mount
      container.append(surface.host)
      sync()
      return () => {
        mount.stop()
        if (stage !== mount) return
        stage = null
        hovering = false
        closePopups()
        parking.append(surface.host)
        sync()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      stage?.stop()
      stopState()
      stopPreferences()
      stopGeometry?.()
      language.disconnect()
      popups.disconnect()
      clearPeeks()
      chat.dispose()
      danmaku.dispose()
      chatNode.remove()
      surface.dispose()
    },
  }
}
