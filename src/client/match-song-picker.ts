import type { PartyController } from './controller'
import { searchMatchSongs, type HostSong } from './host'
import { button, el } from './dom'
import styles from './match-song-picker.css'

// src/client/match-song-picker.ts
export function mountMatchSongPicker(controller: PartyController) {
  const node = el('div', 'mp-match-song')
  const css = el('style')
  css.textContent = styles
  const summary = el('div', 'mp-match-song-summary')
  const title = el('strong'),
    artist = el('span', 'mp-muted')
  summary.append(el('span', 'mp-muted', '匹配用歌曲'), title, artist)
  const toggle = button('切换歌曲', () => {
    if (popup.matches(':popover-open')) close()
    else {
      popup.showPopover()
      renderCurrent()
      position()
      input.focus()
    }
  })
  toggle.setAttribute('aria-haspopup', 'dialog')
  toggle.setAttribute('aria-expanded', 'false')
  const popup = el('div', 'mp-match-song-popup')
  popup.popover = 'auto'
  popup.setAttribute('role', 'dialog')
  popup.setAttribute('aria-label', '选择匹配歌曲')
  const header = el('header', 'mp-picker-header')
  const dismiss = button('', () => close(), 'mp-icon-button')
  dismiss.setAttribute('aria-label', '关闭歌曲选择')
  dismiss.title = '关闭'
  void controller.folium.ui
    .icon('x', { size: 14 })
    .then((icon) => {
      if (icon) {
        icon.setAttribute('aria-hidden', 'true')
        dismiss.append(icon)
      } else dismiss.textContent = '×'
    })
    .catch(() => {
      dismiss.textContent = '×'
    })
  header.append(el('strong', '', '选择匹配歌曲'), dismiss)
  const form = el('form', 'mp-match-search')
  const input = el('input')
  input.type = 'search'
  input.maxLength = 120
  input.placeholder = '搜索歌曲或歌手'
  input.setAttribute('aria-label', '搜索网易云歌曲')
  const submit = button('搜索', () => {})
  submit.type = 'submit'
  form.append(input, submit)
  const useCurrent = button('使用当前歌曲', () => choose(null), 'mp-match-current')
  const status = el('p', 'mp-muted', '搜索并选择下一次匹配使用的歌曲')
  status.setAttribute('role', 'status')
  const results = el('div', 'mp-match-song-results')
  results.setAttribute('aria-label', '匹配歌曲搜索结果')
  popup.append(header, form, useCurrent, status, results)
  node.append(css, summary, toggle, popup)
  let request = 0,
    disposed = false,
    account = controller.state.account?.uid
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancelSearch = () => {
    request++
    clearTimeout(timer)
  }
  function position() {
    if (!popup.matches(':popover-open')) return
    const rect = node.getBoundingClientRect()
    const width = Math.min(340, Math.max(rect.width, 240), window.innerWidth - 16)
    popup.style.width = `${width}px`
    const height = popup.getBoundingClientRect().height
    popup.style.left = `${Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8))}px`
    popup.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - height - 8))}px`
  }
  function close() {
    cancelSearch()
    if (popup.matches(':popover-open')) popup.hidePopover()
    input.value = ''
    results.replaceChildren()
    status.textContent = '搜索并选择下一次匹配使用的歌曲'
  }
  function choose(song: HostSong | null) {
    if (!song && !controller.currentMatchSong()) return
    try {
      controller.selectMatchSong(song)
      close()
      toggle.focus()
    } catch (error) {
      controller.notify(error instanceof Error ? error.message : '无法切换歌曲', 'error')
    }
  }
  function renderCurrent() {
    const current = controller.currentMatchSong()
    useCurrent.disabled = !current
    useCurrent.textContent = current
      ? `使用当前歌曲 · ${current.title || `歌曲 ${current.id}`}`
      : '当前没有网易云歌曲'
    useCurrent.title = useCurrent.textContent
  }
  async function search() {
    cancelSearch()
    const serial = request,
      uid = controller.state.account?.uid
    const query = input.value.trim()
    results.replaceChildren()
    if (!query) {
      status.textContent = '搜索并选择下一次匹配使用的歌曲'
      position()
      return
    }
    status.textContent = '正在搜索…'
    position()
    try {
      const songs = await searchMatchSongs(controller.folium, query)
      if (
        disposed ||
        serial !== request ||
        uid !== controller.state.account?.uid ||
        !popup.matches(':popover-open')
      )
        return
      status.textContent = songs.length
        ? `${songs.length} 首歌曲 · 仅用于匹配`
        : '没有找到歌曲，试试其他关键词'
      for (const song of songs) {
        const pick = button('', () => choose(song), 'mp-match-song-result')
        pick.setAttribute(
          'aria-label',
          `选择 ${song.title}${song.artist ? ` · ${song.artist}` : ''}`,
        )
        const meta = el('span', 'mp-match-result-meta')
        meta.append(
          el('strong', '', song.title),
          el('span', 'mp-muted', [song.artist, song.album].filter(Boolean).join(' · ')),
        )
        pick.append(meta)
        pick.setAttribute('aria-pressed', String(controller.getMatchSong()?.id === song.id))
        results.append(pick)
      }
      position()
    } catch (error) {
      if (disposed || serial !== request || uid !== controller.state.account?.uid) return
      status.textContent = '搜索未完成，请重试'
      controller.notify(error instanceof Error ? error.message : '歌曲搜索失败', 'error')
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void search()
  })
  input.addEventListener('input', () => {
    cancelSearch()
    timer = setTimeout(() => void search(), 300)
  })
  popup.addEventListener('toggle', () => {
    const open = popup.matches(':popover-open')
    toggle.setAttribute('aria-expanded', String(open))
    if (!open) close()
  })
  window.addEventListener('resize', position)
  return {
    node,
    render() {
      const state = controller.state,
        song = controller.getMatchSong()
      title.textContent = song?.title || (song ? `歌曲 ${song.id}` : '尚未选择歌曲')
      title.title = title.textContent
      artist.textContent = song?.artist || ''
      artist.hidden = !song?.artist
      toggle.disabled = state.busy || state.matching || state.checkingRoom
      if (account !== state.account?.uid || toggle.disabled || !state.account) close()
      account = state.account?.uid
      renderCurrent()
    },
    dispose() {
      disposed = true
      close()
      window.removeEventListener('resize', position)
    },
  }
}
