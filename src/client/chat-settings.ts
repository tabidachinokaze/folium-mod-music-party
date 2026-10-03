import {
  danmakuRanges,
  resetDanmakuPreferences,
  type ChatPreferences,
  type ChatPreferenceValues,
} from './chat-preferences'
import { button, el } from './dom'
import { t } from './i18n'
import { mountDetailsPopup } from './popup-position'
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

export function mountChatSettings(container: HTMLElement, preferences: ChatPreferences) {
  const renderers: ((values: ChatPreferenceValues) => void)[] = [],
    css = el('style'),
    box = el('details', 'mp-chat-settings'),
    summary = el('summary'),
    content = el('div', 'mp-chat-settings-popover'),
    title = el('h3'),
    general = el('div', 'mp-chat-settings-general'),
    danmakuSection = el('section', 'mp-chat-settings-section'),
    advanced = el('details', 'mp-chat-settings-advanced'),
    advancedSummary = el('summary'),
    advancedBody = el('div', 'mp-chat-settings-advanced-body'),
    reset = button('', () => resetDanmakuPreferences(preferences), 'mp-chat-settings-reset')
  css.textContent = styles
  function labelText(node: HTMLElement, source: string) {
    renderers.push(() => {
      node.textContent = t(source)
    })
  }
  function selectRow(
    key: SelectKey,
    source: string,
    choices: readonly (readonly [string, string])[],
  ) {
    const row = el('label', 'mp-chat-settings-row'),
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
    renderers.push((values) => {
      select.setAttribute('aria-label', t(source))
      select.value = values[key]
    })
    row.append(caption, select)
    return row
  }
  function toggleRow(key: ToggleKey, source: string) {
    const row = el('label', 'mp-chat-settings-row'),
      caption = el('span'),
      input = el('input')
    labelText(caption, source)
    input.type = 'checkbox'
    input.setAttribute('role', 'switch')
    input.addEventListener('change', () => preferences.set({ [key]: input.checked }))
    renderers.push((values) => {
      input.setAttribute('aria-label', t(source))
      input.checked = values[key]
    })
    row.append(caption, input)
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
  function slider(key: keyof typeof danmakuRanges, source: string) {
    const row = el('label', 'mp-chat-settings-slider'),
      heading = el('span', 'mp-chat-settings-slider-label'),
      caption = el('span'),
      output = el('output'),
      input = el('input'),
      range = danmakuRanges[key]
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
  labelText(summary, '聊天设置')
  labelText(title, '聊天设置')
  renderers.push(() => content.setAttribute('aria-label', t('聊天设置')))
  const position = selectRow('position', '聊天位置', [
      ['panel', '面板内'],
      ['bottom-left', '左下角'],
    ]),
    peekRow = el('label', 'mp-chat-settings-row'),
    peekLabel = el('span'),
    peekControl = el('span', 'mp-chat-settings-seconds'),
    peek = el('input'),
    unit = el('span'),
    hint = el('p', 'mp-muted')
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
  renderers.push((values) => {
    peek.setAttribute('aria-label', t('新消息显示时长'))
    peek.value = String(values.peekSeconds)
    peekRow.hidden = hint.hidden = values.position !== 'bottom-left'
  })
  peekControl.append(peek, unit)
  peekRow.append(peekLabel, peekControl)
  general.append(position, peekRow, hint)

  const enable = toggleRow('danmaku', '启用弹幕'),
    filters = el('div', 'mp-chat-settings-choice'),
    filterLabel = el('span'),
    filterButtons = el('div', 'mp-chat-settings-filters'),
    hoverHint = el('p', 'mp-muted')
  enable.classList.add('mp-chat-settings-heading')
  labelText(filterLabel, '显示内容')
  labelText(hoverHint, '悬停暂停当前弹幕，移开继续。')
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
  danmakuSection.append(
    enable,
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
    hoverHint,
  )
  labelText(advancedSummary, '高级设置')
  advancedBody.append(
    selectRow('danmakuFont', '字体', [
      ['system', '系统默认'],
      ['heiti', '黑体'],
      ['songti', '宋体'],
    ]),
    toggleRow('danmakuBold', '粗体'),
    segmented('danmakuTextStyle', '文字效果', [
      ['shadow', '阴影'],
      ['stroke', '描边'],
      ['none', '无'],
    ]),
    toggleRow('danmakuOverlap', '允许弹幕重叠'),
    toggleRow('danmakuDedupe', '合并重复弹幕'),
  )
  advanced.append(advancedSummary, advancedBody)
  labelText(reset, '恢复弹幕默认设置')
  content.append(title, general, danmakuSection, advanced, reset)
  box.append(summary, content)
  container.append(css, box)
  const popup = mountDetailsPopup(box, content, { width: 340 })
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
    stop()
    language.disconnect()
    popup.dispose()
    box.remove()
    css.remove()
  }
}
