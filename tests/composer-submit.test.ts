import { describe, expect, it, vi } from 'vitest'
import { mountComposerSubmit } from '../src/client/composer-submit'

// tests/composer-submit.test.ts
function setup() {
  const draft = Object.assign(new EventTarget(), {
    value: 'hello',
    disabled: false,
    readOnly: false,
  })
  const submit = { disabled: false, textContent: '发送', title: '', setAttribute: vi.fn() }
  const form = { requestSubmit: vi.fn() }
  const dispose = mountComposerSubmit(
    draft as HTMLTextAreaElement,
    form as unknown as HTMLFormElement,
    submit as unknown as HTMLButtonElement,
  )
  const key = (fields: Partial<KeyboardEvent> = {}) => {
    const event = new Event('keydown', { cancelable: true })
    Object.assign(
      event,
      {
        key: 'Enter',
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        repeat: false,
        isComposing: false,
        keyCode: 13,
      },
      fields,
    )
    draft.dispatchEvent(event)
    return event
  }
  return { draft, submit, form, dispose, key }
}

describe('composer keyboard submit', () => {
  it('uses the existing form for Ctrl+Enter and leaves plain Enter to normal editing', () => {
    const x = setup()
    expect(x.key({ ctrlKey: false }).defaultPrevented).toBe(false)
    expect(x.key({ ctrlKey: false, shiftKey: true }).defaultPrevented).toBe(false)
    expect(x.form.requestSubmit).not.toHaveBeenCalled()
    expect(x.key().defaultPrevented).toBe(true)
    expect(x.form.requestSubmit).toHaveBeenCalledExactlyOnceWith(x.submit)
    expect(x.submit.setAttribute).toHaveBeenCalledWith('aria-keyshortcuts', 'Control+Enter')
    x.dispose()
  })
  it('does not send while an IME is composing or confirming a candidate', () => {
    const x = setup()
    x.draft.dispatchEvent(new Event('compositionstart'))
    x.key()
    x.draft.dispatchEvent(new Event('compositionend'))
    x.key({ isComposing: true })
    x.key({ keyCode: 229 })
    expect(x.form.requestSubmit).not.toHaveBeenCalled()
    x.key()
    expect(x.form.requestSubmit).toHaveBeenCalledOnce()
    x.dispose()
  })
  it('does not submit disabled, readonly, blank drafts or a held key, and cleans up on disposal', () => {
    const x = setup()
    x.submit.disabled = true
    x.key()
    x.submit.disabled = false
    x.draft.disabled = true
    x.key()
    x.draft.disabled = false
    x.draft.readOnly = true
    x.key()
    x.draft.readOnly = false
    x.draft.value = '\n '
    x.key()
    x.draft.value = 'hello'
    x.key({ repeat: true })
    x.key({ altKey: true })
    x.key({ metaKey: true })
    expect(x.form.requestSubmit).not.toHaveBeenCalled()
    x.dispose()
    expect(x.key().defaultPrevented).toBe(false)
    expect(x.form.requestSubmit).not.toHaveBeenCalled()
  })
})
