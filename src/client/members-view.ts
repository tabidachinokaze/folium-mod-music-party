import type { Member, RoomQueueEntry } from '@party/shared/types'
import type { PartyController } from './controller'
import { loadQueue } from './room-data'
import { button, el, iconButton, picture } from './dom'

// src/client/members-view.ts
export function mountMembers(container: HTMLElement, controller: PartyController) {
  const header = el('header', 'mp-member-header'),
    body = el('div', 'mp-member-list'),
    status = el('p', 'mp-muted')
  status.setAttribute('role', 'status')
  const retry = button('重试加载', () => void refresh(true))
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
  const rows = () => {
    const current = controller.state.room?.playback?.song
    const map = new Map([...played, ...waiting].map((song) => [song.songBizId, song]))
    return { current, map }
  }
  function count(uid: string) {
    const { current, map } = rows()
    return (
      [...map.values()].filter((song) => song.songRcmdUid === uid).length +
      (current?.songRcmdUid === uid && !map.has(current.songBizId) ? 1 : 0)
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
    if (!selected)
      header.append(el('h3', '', `${room.onlineCount ?? room.members.length} 人一起听`))
    else
      header.append(
        iconButton(controller.folium.ui, '返回', 'back', () => {
          selected = null
          render()
        }),
        avatar(selected),
        el('strong', 'mp-member-name', selected.nickname),
        el('span', 'mp-muted', complete ? `共推荐 ${count(selected.uid)} 首` : '推荐数加载中'),
      )
    if (!selected)
      header.append(iconButton(controller.folium.ui, '刷新', 'refresh', () => void refresh(true)))
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
        pick.setAttribute('aria-label', `查看 ${member.nickname} 的推荐`)
        pick.append(
          avatar(member),
          el('strong', 'mp-member-name', member.nickname),
          el('span', 'mp-muted', complete ? `推荐 ${count(member.uid)} 首` : '—'),
        )
        body.append(pick)
      })
      if (!room.members.length)
        body.append(el('p', 'mp-empty', room.membersKnown ? '暂无房间成员' : '暂未取得成员信息'))
      if (room.onlineCount !== null && room.onlineCount > room.members.length)
        body.append(el('p', 'mp-muted', `当前返回 ${room.members.length} 位成员资料`))
      return
    }
    if (!complete) {
      body.append(el('p', 'mp-empty', pending ? '正在获取推荐记录…' : '推荐记录暂不可用'))
      return
    }
    const current = room.playback?.song,
      uid = selected.uid
    const group = (title: string, entries: RoomQueueEntry[], canOperate: boolean) => {
      body.append(el('h3', 'mp-member-group', `${title} · ${entries.length}`))
      if (!entries.length) body.append(el('p', 'mp-muted', '暂无歌曲'))
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
        if (!canOperate) actions.append(el('span', 'mp-muted', `${entry.likeCount} 赞`))
        else {
          const operate = (method: 'multiUp' | 'multiRemove') =>
            void controller.run(async () => {
              if (controller.state.room?.roomId !== room.roomId)
                throw new Error('房间已变化，请刷新')
              await controller.operate(method, entry)
              await refresh(true)
            })
          const up = iconButton(controller.folium.ui, '置顶', 'top', () => operate('multiUp'))
          up.disabled = controller.state.busy
          actions.append(up)
          if (entry.songRcmdUid === controller.state.account?.uid) {
            const remove = iconButton(
              controller.folium.ui,
              '删除',
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
    group(
      '待播歌曲',
      waiting.filter((song) => song.songRcmdUid === uid && song.songBizId !== current?.songBizId),
      true,
    )
    const waitingIds = new Set(waiting.map((song) => song.songBizId))
    group(
      '已播歌曲',
      played.filter(
        (song) =>
          song.songRcmdUid === uid &&
          song.songBizId !== current?.songBizId &&
          !waitingIds.has(song.songBizId),
      ),
      false,
    )
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
    status.textContent = '正在同步成员推荐记录…'
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
        status.textContent = error instanceof Error ? error.message : '推荐记录加载失败'
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
  update()
  return {
    show(value: boolean) {
      visible = value
      if (value) update()
    },
    dispose() {
      disposed = true
      generation++
      stop()
    },
  }
}
