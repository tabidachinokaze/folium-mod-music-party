import type { ChatPreferences } from './chat-preferences'
import { el } from './dom'
import { t } from './i18n'
import { mountDetailsPopup } from './popup-position'
import styles from './chat-settings.css'

// src/client/chat-settings.ts
export function mountChatSettings(container: HTMLElement, preferences: ChatPreferences) {
  const css = el('style'),
    box = el('details', 'mp-chat-settings'),
    summary = el('summary'),
    content = el('div', 'mp-chat-settings-popover'),
    title = el('h3'),
    positionRow = el('label', 'mp-chat-settings-row'),
    positionLabel = el('span'),
    position = el('select'),
    panel = el('option'),
    floating = el('option'),
    danmakuRow = el('label', 'mp-chat-settings-row'),
    danmakuLabel = el('span'),
    danmaku = el('input'),
    peekRow = el('label', 'mp-chat-settings-row'),
    peekLabel = el('span'),
    peekControl = el('span', 'mp-chat-settings-seconds'),
    peek = el('input'),
    unit = el('span'),
    hint = el('p', 'mp-muted')
  css.textContent = styles
  panel.value = 'panel'
  floating.value = 'bottom-left'
  position.append(panel, floating)
  position.addEventListener('change', () =>
    preferences.set({ position: position.value === 'bottom-left' ? 'bottom-left' : 'panel' }),
  )
  danmaku.type = 'checkbox'
  danmaku.setAttribute('role', 'switch')
  danmaku.addEventListener('change', () => preferences.set({ danmaku: danmaku.checked }))
  peek.type = 'number'
  peek.min = '1'
  peek.max = '30'
  peek.step = '1'
  peek.inputMode = 'numeric'
  peek.addEventListener('change', () => {
    preferences.set({ peekSeconds: peek.valueAsNumber })
    render()
  })
  positionRow.append(positionLabel, position)
  danmakuRow.append(danmakuLabel, danmaku)
  peekControl.append(peek, unit)
  peekRow.append(peekLabel, peekControl)
  content.append(title, positionRow, danmakuRow, peekRow, hint)
  box.append(summary, content)
  container.append(css, box)
  const popup = mountDetailsPopup(box, content, { width: 280 })
  function render() {
    const values = preferences.get()
    summary.textContent = title.textContent = t('聊天设置')
    content.setAttribute('aria-label', t('聊天设置'))
    positionLabel.textContent = t('聊天位置')
    position.setAttribute('aria-label', t('聊天位置'))
    panel.textContent = t('面板内')
    floating.textContent = t('左下角')
    danmakuLabel.textContent = t('启用弹幕')
    danmaku.setAttribute('aria-label', t('启用弹幕'))
    peekLabel.textContent = t('新消息显示时长')
    peek.setAttribute('aria-label', t('新消息显示时长'))
    unit.textContent = t('秒')
    hint.textContent = t('隐藏时仅临时显示新消息。')
    position.value = values.position
    danmaku.checked = values.danmaku
    peek.value = String(values.peekSeconds)
    peekRow.hidden = hint.hidden = values.position !== 'bottom-left'
  }
  const stop = preferences.subscribe(render),
    language = new MutationObserver(render)
  language.observe(container.ownerDocument.documentElement, {
    attributes: true,
    attributeFilter: ['lang'],
  })
  render()
  return () => {
    stop()
    language.disconnect()
    popup.dispose()
    box.remove()
    css.remove()
  }
}
