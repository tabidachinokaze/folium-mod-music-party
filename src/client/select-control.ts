import { button, el } from './dom'
import { mountPopup } from './popup-position'

// src/client/select-control.ts
// Keep the native value/change contract while matching Folia's compact option menus.
export function mountSelect(select: HTMLSelectElement) {
  const node = el('div', 'mp-select'),
    trigger = button('', () => toggle(), 'mp-select-trigger'),
    caption = el('span', 'mp-select-caption'),
    chevron = el('span', 'mp-select-chevron'),
    menu = el('div', 'mp-select-menu'),
    events = new AbortController(),
    rows = new Map<string, HTMLButtonElement>()
  let active = '',
    search = '',
    searchAt = 0
  menu.id = `mp-select-${crypto.randomUUID()}`
  menu.setAttribute('role', 'listbox')
  trigger.setAttribute('role', 'combobox')
  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-controls', menu.id)
  trigger.setAttribute('aria-expanded', 'false')
  chevron.setAttribute('aria-hidden', 'true')
  trigger.append(caption, chevron)
  select.style.display = 'none'
  select.tabIndex = -1
  select.setAttribute('aria-hidden', 'true')
  node.append(select, trigger, menu)
  const popup = mountPopup(menu, trigger, { placement: 'dropdown', width: 160 })
  const isOpen = () => menu.matches(':popover-open')
  const choices = () => [
    ...menu.querySelectorAll<HTMLButtonElement>('.mp-select-option:not(:disabled)'),
  ]
  function focus(value: string) {
    const row = rows.get(value)
    if (!row || row.disabled) return
    active = value
    row.focus({ preventScroll: true })
    row.scrollIntoView({ block: 'nearest' })
  }
  function choose(value: string) {
    if (select.disabled) return
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    sync()
    popup.close()
    trigger.focus({ preventScroll: true })
  }
  function open() {
    if (select.disabled || node.hidden) return
    sync()
    popup.open()
    focus(rows.get(select.value)?.disabled ? choices()[0]?.dataset.value || '' : select.value)
  }
  function toggle() {
    if (isOpen()) popup.close()
    else open()
  }
  function sync() {
    node.hidden = select.hidden
    trigger.disabled = select.disabled
    const label = select.getAttribute('aria-label') || '',
      options = [...select.options],
      retained = new Set(options.map((option) => option.value))
    caption.textContent = select.selectedOptions[0]?.textContent || ''
    trigger.setAttribute('aria-label', label)
    trigger.setAttribute('aria-valuetext', caption.textContent)
    menu.setAttribute('aria-label', label)
    for (const [value, row] of rows) {
      if (retained.has(value)) continue
      row.remove()
      rows.delete(value)
    }
    for (const option of options) {
      let row = rows.get(option.value)
      if (!row) {
        row = button('', () => choose(option.value), 'mp-select-option')
        row.dataset.value = option.value
        row.setAttribute('role', 'option')
        row.tabIndex = -1
        rows.set(option.value, row)
      }
      row.textContent = option.textContent
      row.disabled = option.disabled
      row.setAttribute('aria-selected', String(option.selected))
      // append moves only when needed, preserving focus while unrelated settings update.
      const index = options.indexOf(option)
      if (menu.children[index] !== row) menu.insertBefore(row, menu.children[index] || null)
    }
    if (node.hidden || select.disabled) popup.close()
  }
  node.addEventListener(
    'keydown',
    (event) => {
      if (select.disabled) return
      const list = choices()
      if (!list.length) return
      if (event.key === 'Tab') {
        if (isOpen()) {
          popup.close()
          trigger.focus({ preventScroll: true })
        }
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        if (isOpen()) choose(active || select.value)
        else open()
        return
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        event.stopPropagation()
        if (!isOpen()) {
          open()
          if (event.key === 'Home') focus(list[0].dataset.value!)
          if (event.key === 'End') focus(list.at(-1)!.dataset.value!)
          return
        }
        const index = list.findIndex((row) => row.dataset.value === active),
          next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? list.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
        focus(list[next].dataset.value!)
        return
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        event.stopPropagation()
        const now = performance.now()
        search = now - searchAt < 600 ? search + event.key : event.key
        searchAt = now
        const row = list.find((item) =>
          item.textContent?.toLocaleLowerCase().startsWith(search.toLocaleLowerCase()),
        )
        if (row) {
          if (!isOpen()) open()
          focus(row.dataset.value!)
        }
      }
    },
    { signal: events.signal },
  )
  select.addEventListener('change', sync, { signal: events.signal })
  sync()
  return {
    node,
    sync,
    dispose() {
      events.abort()
      popup.dispose()
      node.remove()
    },
  }
}
