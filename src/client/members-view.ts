import type { Member, RoomQueueEntry } from '@party/shared/types'
import type { PartyController } from './controller'
import { loadQueue } from './room-data'
import { button, el, iconButton, picture } from './dom'
import { promotionCount } from './queue-counts'
import { t } from './i18n'
import {
  currentRecommendationOwner,
  currentRoomRecommendation,
  memberRecommendationGroups,
} from './member-recommendations'

// src/client/members-view.ts
export function mountMembers(container: HTMLElement, controller: PartyController) {
  const header = el('header', 'mp-member-header'),
    body = el('div', 'mp-member-list'),
    status = el('p', 'mp-muted')
  const equalizer = el('span', 'mp-member-equalizer')
  equalizer.setAttribute('role', 'img')
  for (let index = 0; index < 4; index++) equalizer.append(el('i'))
  status.setAttribute('role', 'status')
  const retry = button(t('重试加载'), () => void refresh(true))
  retry.hidden = true
  container.append(header, status, retry, body)
  let selected: Member | null = null,
    roomId = '',
    loadedKey = '',
    pending = false,
    visible = false,
    disposed = false,
    generation = 0,
    refreshAgain = false
  let played: RoomQueueEntry[] = [],
    waiting: RoomQueueEntry[] = [],
    complete = false
  const avatar = (member: Member) => {
    const node = el('span', 'mp-avatar', member.nickname.slice(0, 1))
    if (member.avatar) node.append(picture(member.avatar, ''))
    return node
  }
  const currentEntry = () => {
    const room = controller.state.room
    return room
      ? currentRoomRecommendation(
          room,
          [...played, ...waiting, ...controller.state.queue],
          controller.folium.playback.getState().song,
        )
      : null
  }
  function count(uid: string) {
    const groups = memberRecommendationGroups(uid, played, waiting, currentEntry())
    return groups.played.length + groups.waiting.length
  }
  function updatePlayback() {
    const song = controller.state.room?.playback?.song,
      playback = controller.folium.playback.getState(),
      playing =
        !!song &&
        playback.state === 'playing' &&
        playback.song?.source === 'netease' &&
        playback.song.id === song.songId
    equalizer.dataset.playing = String(playing && visible)
    equalizer.setAttribute(
      'aria-label',
      playing ? t('正在播放') : song ? t('播放已暂停') : t('暂无播放歌曲'),
    )
  }
  function render() {
    const room = controller.state.room
    if (!room) {
      header.replaceChildren()
      body.replaceChildren()
      return
    }
    header.replaceChildren()
    if (!selected) {
      const owner = currentRecommendationOwner(room, currentEntry())
      header.append(equalizer)
      if (owner) header.append(avatar(owner), el('strong', 'mp-member-name', owner.nickname))
      else header.append(el('span', 'mp-member-name mp-muted', t('暂无播放歌曲')))
      updatePlayback()
    } else
      header.append(
        iconButton(controller.folium.ui, t('返回'), 'back', () => {
          selected = null
          render()
        }),
        avatar(selected),
        el('strong', 'mp-member-name', selected.nickname),
        el(
          'span',
          'mp-muted',
          complete ? t('共推荐 {count} 首', { count: count(selected.uid) }) : t('推荐数加载中'),
        ),
      )
    if (!selected)
      header.append(
        iconButton(controller.folium.ui, t('刷新'), 'refresh', () => void refresh(true)),
      )
    body.replaceChildren()
    if (!selected) {
      room.members.forEach((member) => {
        const pick = button(
          '',
          () => {
            selected = member
            render()
          },
          'mp-member-row',
        )
        pick.setAttribute('aria-label', t('查看 {name} 的推荐', { name: member.nickname }))
        pick.append(
          avatar(member),
          el('strong', 'mp-member-name', member.nickname),
          el(
            'span',
            'mp-muted',
            complete ? t('推荐 {count} 首', { count: count(member.uid) }) : '—',
          ),
        )
        body.append(pick)
      })
      if (!room.members.length)
        body.append(
          el('p', 'mp-empty', room.membersKnown ? t('暂无房间成员') : t('暂未取得成员信息')),
        )
      if (room.onlineCount !== null && room.onlineCount > room.members.length)
        body.append(
          el('p', 'mp-muted', t('当前返回 {count} 位成员资料', { count: room.members.length })),
        )
      return
    }
    if (!complete) {
      body.append(el('p', 'mp-empty', pending ? t('正在获取推荐记录…') : t('推荐记录暂不可用')))
      return
    }
    const current = currentEntry(),
      uid = selected.uid
    const group = (title: string, entries: RoomQueueEntry[], canOperate: boolean) => {
      body.append(
        el('h3', 'mp-member-group', t('{title} · {count}', { title, count: entries.length })),
      )
      if (!entries.length) body.append(el('p', 'mp-muted', t('暂无歌曲')))
      entries.forEach((entry) => {
        const row = el('div', 'mp-track'),
          info = el('div', 'mp-track-info'),
          actions = el('div', 'mp-actions')
        row.dataset.bizId = entry.songBizId
        info.append(
          el('div', 'mp-track-name', entry.track.name),
          el('div', 'mp-muted', entry.track.artist),
        )
        row.append(picture(entry.track.cover, ''), info, actions)
        if (entry.songBizId === current?.songBizId) {
          row.dataset.current = 'true'
          info.append(el('span', 'mp-track-status', t('正在播放')))
        }
        const upCount = promotionCount(entry)
        if (!canOperate)
          actions.append(el('span', 'mp-muted', t('{count} 赞', { count: entry.likeCount })))
        else {
          const operate = (method: 'multiUp' | 'multiRemove') =>
            void controller.run(async () => {
              if (controller.state.room?.roomId !== room.roomId)
                throw new Error(t('房间已变化，请刷新'))
              await controller.operate(method, entry)
              await refresh(true)
            })
          const up = iconButton(controller.folium.ui, t('置顶'), 'top', () => operate('multiUp'))
          up.disabled = controller.state.busy
          up.classList.toggle('mp-promoted', entry.uped)
          up.setAttribute('aria-pressed', String(entry.uped))
          if (entry.uped) up.title = t('已置顶')
          if (upCount !== undefined) {
            const count = el('span', 'mp-muted mp-top-count', String(upCount))
            count.title = t('已被置顶 {count} 次', { count: upCount })
            count.setAttribute('aria-label', count.title)
            actions.append(count)
          }
          actions.append(up)
          if (entry.songRcmdUid === controller.state.account?.uid) {
            const remove = iconButton(
              controller.folium.ui,
              t('删除'),
              'delete',
              () => operate('multiRemove'),
              'danger',
            )
            remove.disabled = controller.state.busy
            actions.append(remove)
          }
        }
        body.append(row)
      })
    }
    const groups = memberRecommendationGroups(uid, played, waiting, current)
    group(t('待播歌曲'), groups.waiting, true)
    group(t('已播歌曲'), groups.played, false)
  }
  async function refresh(force = false) {
    const room = controller.state.room
    if (!visible || !room || disposed) return
    if (pending) {
      if (force) refreshAgain = true
      return
    }
    const key = `${room.roomId}:${room.playback?.version}:${room.playback?.waitSongCount}:${room.members.map((member) => member.uid).join(',')}`
    if (!force && loadedKey === key) return
    const mine = ++generation,
      captured = room.roomId
    pending = true
    retry.hidden = true
    status.textContent = t('正在同步成员推荐记录…')
    const current = () =>
      !disposed && generation === mine && controller.state.room?.roomId === captured
    try {
      const call = controller.connection.call.bind(controller.connection)
      const results = await Promise.all([
        loadQueue(call, captured, current, 'multiPlayed'),
        loadQueue(call, captured, current),
      ])
      if (!current()) return
      ;[played, waiting] = results
      complete = true
      loadedKey = key
      status.textContent = ''
    } catch (error) {
      if (current()) {
        status.textContent = t(error instanceof Error ? error.message : '推荐记录加载失败')
        loadedKey = key
        retry.hidden = false
      }
    } finally {
      if (generation === mine) {
        pending = false
        render()
        if (refreshAgain) {
          refreshAgain = false
          void refresh(true)
        }
      }
    }
  }
  const update = () => {
    const next = controller.state.room?.roomId || ''
    if (next !== roomId) {
      roomId = next
      generation++
      pending = complete = false
      loadedKey = ''
      played = []
      waiting = []
      selected = null
      status.textContent = ''
    }
    if (visible) {
      render()
      void refresh()
    }
  }
  const stop = controller.subscribe(update)
  const stopPlayback = controller.folium.events.on('playback.stateChanged', updatePlayback)
  const stopSong = controller.folium.events.on('playback.songChanged', () => {
    if (visible && !disposed) render()
  })
  update()
  return {
    show(value: boolean) {
      visible = value
      updatePlayback()
      if (value) update()
    },
    dispose() {
      disposed = true
      generation++
      stop()
      stopPlayback()
      stopSong()
    },
  }
}
