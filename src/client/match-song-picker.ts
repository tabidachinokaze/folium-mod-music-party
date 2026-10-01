import type { PartyController } from './controller'
import { searchMatchSongs, type HostSong } from './host'
import { button, el } from './dom'
import { mountPopup } from './popup-position'
import { t } from './i18n'
import styles from './match-song-picker.css'

// src/client/match-song-picker.ts
export function mountMatchSongPicker(controller: PartyController) {
  const node = el('div', 'mp-match-song')
  const css = el('style')
  css.textContent = styles
  const summary = el('div', 'mp-match-song-summary')
  const title = el('strong'),
    artist = el('span', 'mp-muted')
  summary.append(el('span', 'mp-muted', t('匹配用歌曲')), title, artist)
  const toggle = button(t('切换歌曲'), () => {
    if (popup.matches(':popover-open')) close()
    else {
      renderCurrent()
      popupControl.open()
      input.focus()
    }
  })
  toggle.setAttribute('aria-haspopup', 'dialog')
  toggle.setAttribute('aria-expanded', 'false')
  const popup = el('div', 'mp-match-song-popup')
  popup.setAttribute('role', 'dialog')
  popup.setAttribute('aria-label', t('选择匹配歌曲'))
  const header = el('header', 'mp-picker-header')
  const dismiss = button('', () => close(), 'mp-icon-button')
  dismiss.setAttribute('aria-label', t('关闭歌曲选择'))
  dismiss.title = t('关闭')
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
  header.append(el('strong', '', t('选择匹配歌曲')), dismiss)
  const form = el('form', 'mp-match-search')
  const input = el('input')
  input.type = 'search'
  input.maxLength = 120
  input.placeholder = t('搜索歌曲或歌手')
  input.setAttribute('aria-label', t('搜索网易云歌曲'))
  const submit = button(t('搜索'), () => {})
  submit.type = 'submit'
  form.append(input, submit)
  const useCurrent = button(t('使用当前歌曲'), () => choose(null), 'mp-match-current')
  const status = el('p', 'mp-muted', t('搜索并选择下一次匹配使用的歌曲'))
  status.setAttribute('role', 'status')
  const results = el('div', 'mp-match-song-results')
  results.setAttribute('aria-label', t('匹配歌曲搜索结果'))
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
  const popupControl = mountPopup(popup, toggle, { width: 340, align: 'start', onClose: close })
  const position = popupControl.position
  function close() {
    cancelSearch()
    popupControl.close()
    input.value = ''
    results.replaceChildren()
    status.textContent = t('搜索并选择下一次匹配使用的歌曲')
  }
  function choose(song: HostSong | null) {
    if (!song && !controller.currentMatchSong()) return
    try {
      controller.selectMatchSong(song)
      close()
      toggle.focus()
    } catch (error) {
      controller.notify(t(error instanceof Error ? error.message : '无法切换歌曲'), 'error')
    }
  }
  function renderCurrent() {
    const current = controller.currentMatchSong()
    useCurrent.disabled = !current
    useCurrent.textContent = current
      ? t('使用当前歌曲 · {title}', {
          title: current.title || t('歌曲 {id}', { id: current.id ?? '' }),
        })
      : t('当前没有网易云歌曲')
    useCurrent.title = useCurrent.textContent
  }
  async function search() {
    cancelSearch()
    const serial = request,
      uid = controller.state.account?.uid
    const query = input.value.trim()
    results.replaceChildren()
    if (!query) {
      status.textContent = t('搜索并选择下一次匹配使用的歌曲')
      position()
      return
    }
    status.textContent = t('正在搜索…')
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
        ? t('{count} 首歌曲 · 仅用于匹配', { count: songs.length })
        : t('没有找到歌曲，试试其他关键词')
      for (const song of songs) {
        const pick = button('', () => choose(song), 'mp-match-song-result')
        pick.setAttribute(
          'aria-label',
          song.artist
            ? t('选择 {title} · {artist}', { title: song.title, artist: song.artist })
            : t('选择 {title}', { title: song.title }),
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
      status.textContent = t('搜索未完成，请重试')
      controller.notify(t(error instanceof Error ? error.message : '歌曲搜索失败'), 'error')
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
  return {
    node,
    render() {
      const state = controller.state,
        song = controller.getMatchSong()
      title.textContent =
        song?.title || (song ? t('歌曲 {id}', { id: song.id ?? '' }) : t('尚未选择歌曲'))
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
      popupControl.dispose()
    },
  }
}
