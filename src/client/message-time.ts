import { getLocale } from './i18n'

// src/client/message-time.ts
/** Calendar dates use the viewer's local time, consistently across room and private messages. */
export function formatMessageTime(timestamp: number, now = Date.now()) {
  const date = new Date(timestamp),
    current = new Date(now)
  if (!Number.isFinite(date.getTime())) return { text: '', title: '', dateTime: '' }
  const pad = (value: number) => String(value).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const today =
    date.getFullYear() === current.getFullYear() &&
    date.getMonth() === current.getMonth() &&
    date.getDate() === current.getDate()
  const calendar = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const year = date.getFullYear() === current.getFullYear() ? '' : `${date.getFullYear()}-`
  return {
    text: today ? clock : `${year}${calendar} ${clock}`,
    title: date.toLocaleString(getLocale(), { hour12: false }),
    dateTime: date.toISOString(),
  }
}

export function messageTime(timestamp: number): HTMLTimeElement {
  const value = formatMessageTime(timestamp),
    node = document.createElement('time')
  node.textContent = value.text
  node.title = value.title
  if (value.dateTime) node.dateTime = value.dateTime
  else node.hidden = true
  return node
}
