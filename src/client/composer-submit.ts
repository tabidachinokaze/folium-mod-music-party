// src/client/composer-submit.ts
/** Ctrl+Enter submits through the existing form; plain Enter stays available to mentions and newlines. */
export function mountComposerSubmit(
  draft: HTMLTextAreaElement,
  form: HTMLFormElement,
  submit: HTMLButtonElement,
) {
  const events = new AbortController()
  let composing = false
  submit.setAttribute('aria-keyshortcuts', 'Control+Enter')
  submit.title = `${submit.textContent || ''} (Ctrl+Enter)`
  draft.addEventListener(
    'compositionstart',
    () => {
      composing = true
    },
    { signal: events.signal },
  )
  draft.addEventListener(
    'compositionend',
    () => {
      composing = false
    },
    { signal: events.signal },
  )
  draft.addEventListener(
    'keydown',
    (event) => {
      if (
        event.key !== 'Enter' ||
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        composing ||
        event.isComposing ||
        event.keyCode === 229
      )
        return
      // Capture the send chord before the mention list's Enter-selection handler.
      // A plain Enter still reaches that handler, or inserts a newline when it is closed.
      event.preventDefault()
      event.stopImmediatePropagation()
      if (
        event.repeat ||
        draft.disabled ||
        draft.readOnly ||
        submit.disabled ||
        !draft.value.trim()
      )
        return
      form.requestSubmit(submit)
    },
    { capture: true, signal: events.signal },
  )
  return () => events.abort()
}
