import type { MessageAttachment } from '@party/shared/types'
import { messageActionTarget } from '@party/shared/message-content'
import type { PartyController } from './controller'
import { getPlaybackBridge } from './host'
import { t } from './i18n'

// src/client/private-actions.ts
/** Use the host's transport and catalog navigation only after an explicit card click. */
export function createPrivateResourceActions(
  controller: PartyController,
  currentView: () => unknown,
  report: (text: string, error?: boolean) => void,
  openExternal = async (url: string) => {
    const desktop = (window as any).electron?.openExternalUrl
    if (typeof desktop === 'function') {
      if ((await desktop(url)) === false) throw new Error(t('无法打开消息链接'))
    } else window.open(url, '_blank', 'noopener,noreferrer')
  },
) {
  let revision = 0
  const target = (item: MessageAttachment) => messageActionTarget(item.actionUrl)
  return {
    canActivate: (item: MessageAttachment) =>
      !!currentView() && !!controller.state.account && !!target(item),
    label(item: MessageAttachment) {
      const action = target(item),
        values = { name: item.title }
      if (action?.resourceType === 'song')
        return t(controller.state.room ? '推荐 {name} 到房间' : '播放 {name}', values)
      if (action?.resourceType === 'album') return t('查看专辑 {name}', values)
      return t(action?.kind === 'native' ? '在网易云打开 {name}' : '打开 {name}', values)
    },
    async activate(item: MessageAttachment) {
      const action = target(item),
        account = controller.state.account?.uid,
        roomId = controller.state.room?.roomId,
        view = currentView(),
        request = ++revision
      if (!action || !account || !view) return
      const current = () =>
        request === revision &&
        currentView() === view &&
        controller.state.account?.uid === account &&
        controller.state.room?.roomId === roomId
      try {
        if (action.resourceType === 'song' && action.resourceId) {
          if (roomId) {
            await controller.recommend(action.resourceId)
            return
          }
          const bridge = getPlaybackBridge(controller.folium)
          if (!bridge) throw new Error(t('请升级 Folia 后播放这首歌曲'))
          const song = await bridge.resolveSong('netease', action.resourceId)
          if (!current()) return
          if (!song || !(await controller.folium.playback.playSong(song)))
            throw new Error(t('这首歌曲暂时无法播放'))
        } else if (action.resourceType === 'album' && action.resourceId) {
          const openAlbum = controller.folium.ui.openAlbum
          if (!openAlbum) throw new Error(t('请升级 Folia 后在播放器中查看专辑'))
          if (!(await openAlbum('netease', action.resourceId)) && current())
            throw new Error(t('暂时无法打开这张专辑'))
        } else await openExternal(action.url)
      } catch (error) {
        if (current()) report(t(error instanceof Error ? error.message : '无法打开消息链接'), true)
      }
    },
  }
}
