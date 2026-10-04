// src/client/private-scroll.ts
/** Lazy media may resize an existing message after the request's scroll adjustment has finished. */
export function preservePrivateScroll(history: HTMLElement) {
  let following = true,
    anchor: Element | undefined,
    offset = 0
  const capture = () => {
    following = history.scrollHeight - history.clientHeight - history.scrollTop < 48
    const top = history.getBoundingClientRect().top
    anchor = [...history.children].find((node) => node.getBoundingClientRect().bottom > top + 1)
    offset = anchor ? anchor.getBoundingClientRect().top - top : 0
  }
  const settle = () => {
    if (following) history.scrollTop = history.scrollHeight
    else if (anchor?.parentElement === history)
      history.scrollTop +=
        anchor.getBoundingClientRect().top - history.getBoundingClientRect().top - offset
    capture()
  }
  history.addEventListener('load', settle, true)
  history.addEventListener('loadedmetadata', settle, true)
  return {
    capture,
    mutate(change: () => void) {
      capture()
      change()
      settle()
    },
    dispose() {
      history.removeEventListener('load', settle, true)
      history.removeEventListener('loadedmetadata', settle, true)
      anchor = undefined
    },
  }
}
