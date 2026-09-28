import styles from './panel.css'
import type { PartyController, PartyState } from './controller'
import { button, el, messageNode, picture } from './dom'
import { mountPrivate } from './private-view'
import { createStickerPicker } from './sticker-view'

// src/client/panel.ts
export function mountPanel(container: HTMLElement, controller: PartyController) {
  const host = el('div')
  host.style.height = '100%'
  container.append(host)
  const root = host.attachShadow({ mode: 'open' }),
    css = el('style')
  css.textContent = styles
  const page = el('div', 'mp')
  root.append(css, page)
  const header = el('header', 'mp-header'),
    title = el('div', 'mp-title'),
    words = el('div')
  words.append(el('div', 'mp-eyebrow', 'LISTEN · TOGETHER'), el('div', 'mp-brand', 'Music Party'))
  title.append(el('span', 'mp-logo', '♫'), words)
  const badge = el('span', 'mp-pill', '官方多人房间')
  header.append(title, badge)
  const nav = el('nav', 'mp-nav')
  nav.setAttribute('role', 'tablist')
  nav.setAttribute('aria-label', '一起听功能')
  const error = el('div', 'mp-error')
  error.setAttribute('role', 'alert')
  const notice = el('div', 'mp-notice')
  notice.setAttribute('role', 'status')
  const health = el('div', 'mp-health')
  const sections = ['房间', '待播', '聊天', '私信'].map((name) => {
    const node = el('section', 'mp-view')
    node.setAttribute('aria-label', name)
    return node
  })
  const [roomView, queueView, chatView, privateView] = sections
  let tab = 0,
    disposed = false
  const tabs = sections.map((section, i) => {
    const pick = button(['房间', '待播', '聊天', '私信'][i], () => {
      tab = i
      renderTabs()
      if (i === 3) privateUi.show()
    })
    pick.setAttribute('role', 'tab')
    nav.append(pick)
    return pick
  })
  function renderTabs() {
    sections.forEach((section, i) => {
      section.hidden = tab !== i
      tabs[i].setAttribute('aria-selected', String(tab === i))
    })
  }
  const hero = el('div', 'mp-hero')
  hero.append(
    el('p', 'mp-eyebrow', 'A ROOM FOR YOUR MUSIC'),
    el('h2', '', '好歌，一起听。'),
    el('p', 'mp-muted', '用 Folia 的歌词与音效，和网易云 App 里的朋友听同一首歌。'),
  )
  const account = el('p', 'mp-muted')
  const connect = button(
    '连接网易云账号',
    () => void controller.run(() => controller.connect()),
    'primary mp-command',
  )
  const prerequisite = el(
    'div',
    'mp-error',
    '此 Folia 尚未安装播放适配接口 v1。请使用 tabidachinokaze/folia-major 的适配版本，详见插件安装说明。',
  )
  const enter = el('div', 'mp-section')
  const restore = button(
    '恢复当前房间',
    () => void controller.run(() => controller.enter('restore')),
    'primary mp-command',
  )
  const create = button(
    '用当前歌曲创建',
    () => void controller.run(() => controller.enter('create')),
    'mp-command',
  )
  const joinInput = el('textarea', 'mp-invite')
  joinInput.placeholder = '粘贴网易云多人一起听邀请链接…'
  joinInput.setAttribute('aria-label', '多人邀请链接')
  const join = button(
    '通过链接加入',
    () => void controller.run(() => controller.enter('join', joinInput.value)),
    'mp-command',
  )
  const enterActions = el('div', 'mp-row')
  enterActions.append(restore, create)
  enter.append(enterActions, joinInput, join)
  const active = el('div'),
    now = el('div', 'mp-now'),
    nowTitle = el('h3'),
    nowArtist = el('p', 'mp-muted')
  now.append(el('div', 'mp-eyebrow', 'NOW PLAYING'), nowTitle, nowArtist)
  const actions = el('div', 'mp-row')
  actions.append(
    button(
      '请求下一首',
      () => void controller.run(() => controller.operate('multiNext')),
      'primary mp-command',
    ),
    button(
      '为这首歌点赞',
      () => void controller.run(() => controller.operate('multiLike')),
      'mp-command',
    ),
    button('重新同步', () => void controller.run(() => controller.refresh()), 'mp-command'),
  )
  const members = el('div', 'mp-members'),
    memberLabel = el('h3'),
    roomLabel = el('p', 'mp-muted')
  const share = el('div', 'mp-row mp-section')
  share.append(
    button(
      '复制邀请链接',
      () =>
        void controller.run(async () => {
          await navigator.clipboard.writeText(controller.shareLink())
          controller.patch({ notice: '邀请链接已复制' })
        }),
      'mp-command',
    ),
    button('私信邀请', () => {
      tab = 3
      renderTabs()
      privateUi.show()
    }),
    button('退出房间', () => void controller.run(() => controller.leave()), 'danger mp-command'),
  )
  active.append(now, actions, memberLabel, members, share, roomLabel)
  roomView.append(hero, prerequisite, account, connect, enter, active)

  const queueTitle = el('h3'),
    queue = el('div'),
    searchResults = el('div')
  const searchForm = el('form', 'mp-row'),
    searchInput = el('input', 'grow')
  searchInput.placeholder = '搜索网易云歌曲，推荐给大家'
  searchInput.setAttribute('aria-label', '搜索推荐歌曲')
  const search = el('button', 'mp-button mp-command', '搜索')
  search.type = 'submit'
  searchForm.append(searchInput, search)
  searchForm.addEventListener('submit', (event) => {
    event.preventDefault()
    void controller.run(async () => {
      controller.requireRoom()
      if (!searchInput.value.trim()) return
      const result = await controller.folium.internals.omni.searchProviderSongs(
        'netease',
        searchInput.value.trim(),
        { limit: 15, offset: 0 },
      )
      if (disposed) return
      searchResults.replaceChildren()
      result.items.forEach((song: any) => {
        const row = el('div', 'mp-track'),
          info = el('div', 'mp-track-info')
        info.append(
          el('div', 'mp-track-name', song.name),
          el('div', 'mp-muted', (song.artists || []).map((artist: any) => artist.name).join(' / ')),
        )
        row.append(
          info,
          button(
            '推荐',
            () => void controller.run(() => controller.recommend(String(song.id))),
            'mp-command',
          ),
        )
        searchResults.append(row)
      })
      if (!result.items.length) searchResults.append(el('p', 'mp-empty', '没有找到相关歌曲'))
    })
  })
  queueView.append(
    searchForm,
    searchResults,
    queueTitle,
    button(
      '刷新完整队列',
      () => void controller.run(() => controller.refreshQueue()),
      'mp-command',
    ),
    queue,
  )

  const history = el('div', 'mp-history'),
    older = button('加载更早的聊天', () => void controller.run(() => controller.refreshChat(true)))
  const composer = el('form', 'mp-composer'),
    draft = el('textarea')
  draft.maxLength = 100
  draft.placeholder = '和房间里的朋友聊聊这首歌…'
  draft.setAttribute('aria-label', '房间聊天内容')
  const sticker = createStickerPicker(
    controller,
    (emoji) => controller.send(`[${emoji.emojiName}]`, emoji),
    'room',
  )
  const send = el('button', 'mp-button primary mp-command', '发送')
  send.type = 'submit'
  composer.append(draft, sticker.node, send)
  composer.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = draft.value
    void controller.run(async () => {
      await controller.send(text)
      if (draft.value === text) draft.value = ''
    })
  })
  chatView.append(
    el('p', 'mp-muted', '与网易云官方多人房间互通 · 最多 100 字'),
    older,
    history,
    composer,
  )
  const privateUi = mountPrivate(privateView, controller)
  page.append(header, nav, error, notice, ...sections, health)
  let previous: PartyState | null = null
  function render() {
    const state = controller.state,
      room = state.room
    if (previous?.account?.uid !== state.account?.uid) privateUi.reset()
    badge.textContent = room
      ? `${room.onlineCount ?? room.members.length} 人一起听`
      : '官方多人房间'
    error.textContent = state.error
    error.hidden = !state.error
    notice.textContent = state.notice
    notice.hidden = !state.notice
    health.textContent = state.health
    prerequisite.hidden = state.ready
    account.textContent = state.account
      ? `已连接 · ${state.account.nickname}`
      : '复用 Folia 中已登录的网易云账号'
    connect.hidden = !!room
    connect.textContent = state.account ? '重新连接账号' : '连接网易云账号'
    enter.hidden = !!room || !state.account || !state.ready
    active.hidden = !room
    hero.hidden = !!room
    tabs[1].disabled = tabs[2].disabled = !room
    tabs[3].disabled = !state.account
    if ((tab === 1 || tab === 2) && !room) tab = 0
    if (tab === 3 && !state.account) tab = 0
    renderTabs()
    if (room) {
      const playing = controller.folium.playback.getState().song
      nowTitle.textContent =
        playing?.id === room.playback?.song?.songId
          ? playing!.title
          : room.playback?.song
            ? '正在加载房间歌曲…'
            : '等待大家推荐歌曲'
      nowArtist.textContent = playing?.id === room.playback?.song?.songId ? playing!.artist : ''
      roomLabel.textContent = `房间 ${room.roomId}`
      memberLabel.textContent = `正在一起听 · ${room.onlineCount ?? room.members.length} 人`
      if (previous?.room?.members !== room.members)
        members.replaceChildren(
          ...room.members.map((member) => {
            const node = el('span', 'mp-member')
            node.append(picture(member.avatar, ''), document.createTextNode(member.nickname))
            return node
          }),
        )
    }
    queueTitle.textContent = `待播列表 · ${room?.playback?.waitSongCount ?? state.queue.length} 首${state.queueLoading ? ' · 正在读取完整列表…' : ''}`
    if (
      previous?.queue !== state.queue ||
      previous?.room?.playback?.song?.songBizId !== room?.playback?.song?.songBizId
    ) {
      queue.replaceChildren(
        ...state.queue
          .filter((row) => row.songBizId !== room?.playback?.song?.songBizId)
          .map((entry) => {
            const row = el('div', 'mp-track'),
              info = el('div', 'mp-track-info'),
              commands = el('div', 'mp-actions')
            info.append(
              el('div', 'mp-track-name', entry.track.name),
              el('div', 'mp-muted', `${entry.track.artist} · ${entry.recommender || '听友'} 推荐`),
            )
            commands.append(
              button(
                '置顶',
                () => void controller.run(() => controller.operate('multiUp', entry)),
                'mp-command',
              ),
            )
            if (entry.songRcmdUid === state.account?.uid)
              commands.append(
                button(
                  '删除',
                  () => void controller.run(() => controller.operate('multiRemove', entry)),
                  'mp-command',
                ),
              )
            row.append(picture(entry.track.cover, ''), info, commands)
            return row
          }),
      )
      if (!queue.childElementCount)
        queue.append(
          el(
            'p',
            'mp-empty',
            state.queueLoading ? '正在读取待播列表…' : '还没有待播歌曲，推荐一首吧。',
          ),
        )
    }
    older.hidden = !state.chatMore
    if (previous?.messages !== state.messages) {
      const nearEnd = history.scrollHeight - history.scrollTop - history.clientHeight < 80
      history.replaceChildren(
        ...state.messages.map((message) =>
          messageNode(message, message.uid === state.account?.uid),
        ),
      )
      if (!state.messages.length) history.append(el('p', 'mp-empty', '还没有聊天消息'))
      if (nearEnd) history.scrollTop = history.scrollHeight
    }
    root.querySelectorAll<HTMLButtonElement>('.mp-command').forEach((command) => {
      command.disabled = state.busy
    })
    previous = state
  }
  const stop = controller.subscribe(render),
    stopSong = controller.folium.events.on('playback.songChanged', render)
  render()
  return () => {
    disposed = true
    stop()
    stopSong()
    sticker.dispose()
    privateUi.dispose()
    host.remove()
  }
}
