import {
  danmakuRanges,
  floatingChatRanges,
  resetChatDisplayPreferences,
  resetDanmakuPreferences,
  type ChatPreferences,
  type ChatPreferenceValues,
} from './chat-preferences'
import { button, el } from './dom'
import type { Folium } from './host'
import { t } from './i18n'
import { mountDetailsPopup } from './popup-position'
import { mountSelect } from './select-control'
import styles from './chat-settings.css'

// src/client/chat-settings.ts
type ToggleKey =
  | 'danmaku'
  | 'danmakuBold'
  | 'danmakuText'
  | 'danmakuMedia'
  | 'danmakuActivity'
  | 'danmakuOverlap'
  | 'danmakuDedupe'
type SelectKey = 'position' | 'danmakuFont' | 'danmakuMode' | 'danmakuTextStyle'
const sliderRanges = { ...danmakuRanges, ...floatingChatRanges }

export function mountChatSettings(
  container: HTMLElement,
  preferences: ChatPreferences,
  ui?: Pick<Folium['ui'], 'icon'>,
  onDanmakuPreview?: (visible: boolean) => void,
) {
  const renderers: ((values: ChatPreferenceValues) => void)[] = [],
    disposers: (() => void)[] = [],
    css = el('style'),
    navigation = el('div', 'mp-chat-settings')
  let disposed = false
  css.textContent = styles
  function labelText(node: HTMLElement, source: string) {
    renderers.push(() => {
      node.textContent = t(source)
    })
  }
  function icon(name: string) {
    const holder = el('span', 'mp-chat-settings-icon')
    holder.setAttribute('aria-hidden', 'true')
    void ui
      ?.icon(name, { size: 14 })
      .then((svg) => {
        if (svg && !disposed) holder.append(svg)
      })
      .catch(() => {})
    return holder
  }
  function createEntry(kind: 'chat' | 'danmaku', source: string, iconName: string) {
    const box = el('details', 'mp-chat-settings-entry'),
      summary = el('summary', 'mp-chat-settings-navigation'),
      caption = el('span', 'mp-chat-settings-caption'),
      chevron = el('span', 'mp-chat-settings-chevron'),
      content = el('div', 'mp-chat-settings-popover'),
      title = el('h3')
    box.dataset.settings = content.dataset.settings = kind
    chevron.setAttribute('aria-hidden', 'true')
    labelText(caption, source)
    labelText(title, kind === 'chat' ? '聊天显示' : '弹幕设置')
    renderers.push(() => {
      summary.setAttribute('aria-label', t(kind === 'chat' ? '聊天显示' : '弹幕设置'))
      content.setAttribute('aria-label', t(kind === 'chat' ? '聊天显示' : '弹幕设置'))
    })
    summary.append(icon(iconName), caption, chevron)
    content.append(title)
    box.append(summary, content)
    navigation.append(box)
    const popup = mountDetailsPopup(box, content, {
      width: 320,
      maxHeight: 'viewport',
    })
    disposers.push(() => popup.dispose())
    if (kind === 'danmaku') {
      const preview = () => onDanmakuPreview?.(!disposed && content.matches(':popover-open'))
      content.addEventListener('toggle', preview)
      disposers.push(() => {
        content.removeEventListener('toggle', preview)
        onDanmakuPreview?.(false)
      })
    }
    return { summary, caption, chevron, content }
  }
  function selectRow(
    key: SelectKey,
    source: string,
    choices: readonly (readonly [string, string])[],
  ) {
    const row = el('div', 'mp-chat-settings-row'),
      caption = el('span'),
      select = el('select')
    labelText(caption, source)
    for (const [value, name] of choices) {
      const option = el('option')
      option.value = value
      labelText(option, name)
      select.append(option)
    }
    select.addEventListener('change', () => preferences.set({ [key]: select.value }))
    const control = mountSelect(select)
    disposers.push(() => control.dispose())
    renderers.push((values) => {
      select.setAttribute('aria-label', t(source))
      select.value = values[key]
      control.sync()
    })
    row.append(caption, control.node)
    return row
  }
  function toggle(key: ToggleKey, source: string) {
    const input = el('input', 'mp-chat-settings-switch')
    input.type = 'checkbox'
    input.setAttribute('role', 'switch')
    // A navigation-row switch changes enablement without opening its settings.
    input.addEventListener('click', (event) => event.stopPropagation())
    input.addEventListener('keydown', (event) => event.stopPropagation())
    input.addEventListener('change', () => preferences.set({ [key]: input.checked }))
    renderers.push((values) => {
      input.setAttribute('aria-label', t(source))
      input.title = t(source)
      input.checked = values[key]
    })
    return input
  }
  function toggleRow(key: ToggleKey, source: string) {
    const row = el('label', 'mp-chat-settings-row'),
      caption = el('span')
    labelText(caption, source)
    row.append(caption, toggle(key, source))
    return row
  }
  function segmented(
    key: SelectKey,
    source: string,
    choices: readonly (readonly [string, string])[],
  ) {
    const row = el('div', 'mp-chat-settings-choice'),
      caption = el('span'),
      controls = el('div', 'mp-chat-settings-segments')
    labelText(caption, source)
    controls.setAttribute('role', 'group')
    renderers.push(() => controls.setAttribute('aria-label', t(source)))
    for (const [value, name] of choices) {
      const pick = button('', () => preferences.set({ [key]: value }))
      labelText(pick, name)
      renderers.push((values) => pick.setAttribute('aria-pressed', String(values[key] === value)))
      controls.append(pick)
    }
    row.append(caption, controls)
    return row
  }
  function slider(key: keyof typeof sliderRanges, source: string) {
    const row = el('label', 'mp-chat-settings-slider'),
      heading = el('span', 'mp-chat-settings-slider-label'),
      caption = el('span'),
      output = el('output'),
      input = el('input'),
      range = sliderRanges[key]
    labelText(caption, source)
    input.type = 'range'
    input.min = String(range.min)
    input.max = String(range.max)
    input.step = String(range.step)
    input.addEventListener('input', () => preferences.set({ [key]: input.valueAsNumber }))
    renderers.push((values) => {
      const value = values[key],
        text = key === 'danmakuSpeed' ? `${value / 100}×` : `${value}%`
      input.setAttribute('aria-label', t(source))
      input.setAttribute('aria-valuetext', text)
      input.value = String(value)
      input.style.setProperty(
        '--mp-slider-progress',
        `${((value - range.min) / (range.max - range.min)) * 100}%`,
      )
      output.textContent = text
    })
    heading.append(caption, output)
    row.append(heading, input)
    return row
  }

  const chat = createEntry('chat', '聊天显示', 'message-square'),
    positionSummary = el('span', 'mp-chat-settings-value'),
    floating = el('div', 'mp-chat-settings-floating'),
    peekRow = el('label', 'mp-chat-settings-row'),
    peekLabel = el('span'),
    peekControl = el('span', 'mp-chat-settings-seconds'),
    peek = el('input'),
    unit = el('span'),
    hint = el('p', 'mp-muted'),
    resetChat = button('', () => resetChatDisplayPreferences(preferences), 'mp-chat-settings-reset')
  chat.summary.insertBefore(positionSummary, chat.chevron)
  peek.type = 'number'
  peek.min = '1'
  peek.max = '30'
  peek.step = '1'
  peek.inputMode = 'numeric'
  peek.addEventListener('change', () => {
    preferences.set({ peekSeconds: peek.valueAsNumber })
    render()
  })
  labelText(peekLabel, '新消息显示时长')
  labelText(unit, '秒')
  labelText(hint, '隐藏时仅临时显示新消息。')
  labelText(resetChat, '恢复聊天显示默认设置')
  renderers.push((values) => {
    positionSummary.textContent = t(values.position === 'panel' ? '面板内' : '左下角')
    peek.setAttribute('aria-label', t('新消息显示时长'))
    peek.value = String(values.peekSeconds)
    floating.hidden = values.position !== 'bottom-left'
  })
  peekControl.append(peek, unit)
  peekRow.append(peekLabel, peekControl)
  floating.append(
    peekRow,
    hint,
    slider('floatingOpacity', '消息不透明度'),
    slider('floatingBubbleOpacity', '消息气泡不透明度'),
    slider('floatingInputOpacity', '输入区背景不透明度'),
    slider('floatingFontSize', '聊天字号'),
    slider('floatingLineHeight', '聊天行距'),
  )
  chat.content.append(
    selectRow('position', '聊天位置', [
      ['panel', '面板内'],
      ['bottom-left', '左下角'],
    ]),
    floating,
    resetChat,
  )

  const danmaku = createEntry('danmaku', '弹幕', 'captions'),
    filters = el('div', 'mp-chat-settings-choice'),
    filterLabel = el('span'),
    filterButtons = el('div', 'mp-chat-settings-filters'),
    advanced = el('details', 'mp-chat-settings-advanced'),
    advancedSummary = el('summary'),
    advancedBody = el('div', 'mp-chat-settings-advanced-body'),
    resetDanmaku = button('', () => resetDanmakuPreferences(preferences), 'mp-chat-settings-reset')
  danmaku.summary.insertBefore(toggle('danmaku', '启用弹幕'), danmaku.chevron)
  labelText(filterLabel, '显示内容')
  filterButtons.setAttribute('role', 'group')
  renderers.push(() => filterButtons.setAttribute('aria-label', t('显示内容')))
  for (const [key, name] of [
    ['danmakuText', '文字消息'],
    ['danmakuMedia', '图片与表情'],
    ['danmakuActivity', '房间动态'],
  ] as const) {
    const pick = button('', () => preferences.set({ [key]: !preferences.get()[key] }))
    labelText(pick, name)
    renderers.push((values) => pick.setAttribute('aria-pressed', String(values[key])))
    filterButtons.append(pick)
  }
  filters.append(filterLabel, filterButtons)
  labelText(advancedSummary, '高级设置')
  advancedBody.append(
    selectRow('danmakuFont', '字体', [
      ['system', '系统默认'],
      ['heiti', '黑体'],
      ['songti', '宋体'],
    ]),
    toggleRow('danmakuBold', '粗体'),
    slider('danmakuBackgroundOpacity', '弹幕背景不透明度'),
    slider('danmakuHoverOpacity', '悬停背景不透明度'),
    segmented('danmakuTextStyle', '文字效果', [
      ['shadow', '阴影'],
      ['stroke', '描边'],
      ['none', '无'],
    ]),
    toggleRow('danmakuOverlap', '允许弹幕重叠'),
    toggleRow('danmakuDedupe', '合并重复弹幕'),
  )
  advanced.append(advancedSummary, advancedBody)
  labelText(resetDanmaku, '恢复弹幕默认设置')
  danmaku.content.append(
    segmented('danmakuMode', '显示模式', [
      ['scroll', '滚动'],
      ['top', '顶部'],
      ['bottom', '底部'],
    ]),
    filters,
    slider('danmakuArea', '显示区域'),
    slider('danmakuOpacity', '不透明度'),
    slider('danmakuFontSize', '字号'),
    slider('danmakuSpeed', '速度'),
    advanced,
    resetDanmaku,
  )
  container.append(css, navigation)
  function render() {
    const values = preferences.get()
    for (const update of renderers) update(values)
  }
  const stop = preferences.subscribe(render),
    language = new MutationObserver(render)
  language.observe(container.ownerDocument.documentElement, {
    attributes: true,
    attributeFilter: ['lang'],
  })
  render()
  return () => {
    disposed = true
    stop()
    language.disconnect()
    // Dispose nested controls before their containing popovers.
    for (const dispose of disposers.reverse()) dispose()
    navigation.remove()
    css.remove()
  }
}
