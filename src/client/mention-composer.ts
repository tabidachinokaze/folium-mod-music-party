import type { Member } from '@party/shared/types'
import { button, el, picture } from './dom'
import { t } from './i18n'

// src/client/mention-composer.ts
interface MentionComposerOptions {
  draft: HTMLTextAreaElement
  composer: HTMLElement
  members: () => Member[]
  notify: (text: string) => void
}
interface MentionRange {
  start: number
  end: number
  query: string
}
let nextPickerId = 0

export function mountMentionComposer({ draft, composer, members, notify }: MentionComposerOptions) {
  const events = new AbortController()
  const popup = el('div', 'mp-mention-popup')
  popup.id = `mp-mention-picker-${++nextPickerId}`
  popup.setAttribute('role', 'listbox')
  popup.setAttribute('aria-label', t('提及成员'))
  popup.hidden = true
  composer.append(popup)
  let open = false,
    disposed = false,
    composing = false,
    active = 0
  let candidates: Member[] = [],
    range: MentionRange | null = null

  function currentQuery(): MentionRange | null {
    if (draft.selectionStart !== draft.selectionEnd) return null
    const end = draft.selectionStart
    const start = draft.value.lastIndexOf('@', end - 1)
    if (start < 0 || start >= end) return null
    const query = draft.value.slice(start + 1, end)
    // Keep email addresses and completed mentions out of the suggestion list.
    if (/\s|@/u.test(query) || (start > 0 && /[A-Za-z0-9._%+-]/u.test(draft.value[start - 1])))
      return null
    return { start, end, query }
  }

  function close() {
    open = false
    range = null
    candidates = []
    popup.hidden = true
    popup.replaceChildren()
    trigger.setAttribute('aria-expanded', 'false')
    draft.removeAttribute('aria-controls')
    draft.removeAttribute('aria-expanded')
    draft.removeAttribute('aria-activedescendant')
  }

  function select(index: number, scroll = false) {
    active = candidates.length ? (index + candidates.length) % candidates.length : 0
    const options = [...popup.querySelectorAll<HTMLElement>('[role="option"]')]
    options.forEach((option, i) => option.setAttribute('aria-selected', String(i === active)))
    const selected = options[active]
    if (selected) {
      draft.setAttribute('aria-activedescendant', selected.id)
      if (scroll) selected.scrollIntoView({ block: 'nearest' })
    } else draft.removeAttribute('aria-activedescendant')
  }

  function insert(member: Member, selection: { start: number; end: number }) {
    if (disposed || draft.disabled || draft.readOnly) return
    const nickname = member.nickname.trim()
    if (!nickname) return
    const text = `@${nickname} `
    const limit = draft.maxLength > 0 ? Math.min(100, draft.maxLength) : 100
    if (draft.value.length - (selection.end - selection.start) + text.length > limit) {
      notify(t('最多输入 {limit} 字，剩余空间不足以提及这位成员', { limit }))
      draft.focus({ preventScroll: true })
      return
    }
    draft.setRangeText(text, selection.start, selection.end, 'end')
    close()
    draft.focus({ preventScroll: true })
    draft.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
  }

  function choose(member: Member) {
    if (!range || composing) return
    insert(member, range)
  }

  function render(nextRange: MentionRange) {
    if (disposed || composing || draft.disabled || draft.readOnly) return
    const selectedUid = candidates[active]?.uid
    range = nextRange
    const query = nextRange.query.toLocaleLowerCase()
    const seen = new Set<string>()
    candidates = members().filter((member) => {
      if (!member.nickname.trim() || seen.has(member.uid)) return false
      seen.add(member.uid)
      return member.nickname.toLocaleLowerCase().includes(query)
    })
    popup.replaceChildren(
      ...candidates.map((member, index) => {
        const option = button('', () => choose(member), 'mp-mention-option')
        option.id = `${popup.id}-${index}`
        option.tabIndex = -1
        option.setAttribute('role', 'option')
        option.setAttribute('aria-label', member.nickname)
        option.addEventListener('pointerdown', (event) => event.preventDefault())
        const avatar = el('span', 'mp-mention-avatar')
        avatar.setAttribute('aria-hidden', 'true')
        const initial = el('span', '', [...member.nickname][0] || '@')
        avatar.append(initial)
        if (member.avatar) {
          const image = picture(member.avatar)
          image.addEventListener('load', () => (initial.hidden = true), { once: true })
          avatar.append(image)
        }
        option.append(avatar, el('span', 'mp-mention-name', member.nickname))
        return option
      }),
    )
    if (!candidates.length) popup.append(el('p', 'mp-mention-empty', t('没有匹配的房间成员')))
    open = true
    popup.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    draft.setAttribute('aria-expanded', 'true')
    draft.setAttribute('aria-controls', popup.id)
    select(
      Math.max(
        0,
        candidates.findIndex((member) => member.uid === selectedUid),
      ),
    )
  }

  const trigger = button(
    '@',
    () => {
      if (open) return close()
      if (composing || disposed || draft.disabled || draft.readOnly) return
      const query = currentQuery()
      render(query || { start: draft.selectionStart, end: draft.selectionEnd, query: '' })
      draft.focus({ preventScroll: true })
    },
    'mp-mention-trigger',
  )
  trigger.setAttribute('aria-label', t('提及成员'))
  trigger.setAttribute('aria-haspopup', 'listbox')
  trigger.setAttribute('aria-controls', popup.id)
  trigger.setAttribute('aria-expanded', 'false')
  trigger.title = t('提及成员')
  trigger.addEventListener('pointerdown', (event) => event.preventDefault(), {
    signal: events.signal,
  })

  const update = () => {
    if (composing || disposed) return
    const query = currentQuery()
    if (query) render(query)
    else close()
  }
  draft.addEventListener('input', update, { signal: events.signal })
  draft.addEventListener('click', update, { signal: events.signal })
  draft.addEventListener(
    'compositionstart',
    () => {
      composing = true
      close()
    },
    { signal: events.signal },
  )
  draft.addEventListener(
    'compositionend',
    () => {
      composing = false
      update()
    },
    { signal: events.signal },
  )
  draft.addEventListener(
    'keydown',
    (event) => {
      if (!open || composing || event.isComposing || event.keyCode === 229) return
      if (event.key === 'Tab') return close()
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') close()
      else if (event.key === 'Enter') {
        const member = candidates[active]
        if (member) choose(member)
      } else select(active + (event.key === 'ArrowDown' ? 1 : -1), true)
    },
    { signal: events.signal },
  )
  draft.addEventListener(
    'keyup',
    (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) update()
    },
    { signal: events.signal },
  )
  document.addEventListener(
    'pointerdown',
    (event) => {
      const path = event.composedPath()
      if (!path.includes(popup) && !path.includes(trigger) && !path.includes(draft)) close()
    },
    { signal: events.signal },
  )

  return {
    button: trigger,
    mention(member: Member) {
      insert(member, { start: draft.selectionStart, end: draft.selectionEnd })
    },
    close,
    dispose() {
      disposed = true
      close()
      events.abort()
      popup.remove()
      trigger.remove()
    },
  }
}
