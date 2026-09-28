export interface Preferences {
  closeToTray: boolean
  theme: 'dark' | 'light' | 'system'
  volume: number
  repeatMode: 'order' | 'loop' | 'single'
}
export interface WindowGeometry {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}
export interface DesktopInfo {
  preferences: Preferences
  trayAvailable: boolean
  fullScreen: boolean
  fullScreenRevision: number
  resolvedTheme: 'dark' | 'light'
  platform: string
  persistenceError: string
}
export type PlayerCommand =
  'toggle' | 'play' | 'pause' | 'next' | 'previous' | 'settings' | 'lyrics' | 'show'
export interface DesktopMediaState {
  title: string
  artist: string
  playing: boolean
  canToggle: boolean
  canNext: boolean
  canPrevious: boolean
  roomId: string | null
}
export const DEFAULT_PREFERENCES: Preferences = {
  closeToTray: true,
  theme: 'dark',
  volume: 0.6,
  repeatMode: 'order',
}
export function validatePreferences(value: unknown): Partial<Preferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('设置格式无效')
  const result: Partial<Preferences> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key === 'closeToTray' && typeof item === 'boolean') result.closeToTray = item
    else if (key === 'theme' && ['dark', 'light', 'system'].includes(String(item)))
      result.theme = item as Preferences['theme']
    else if (
      key === 'volume' &&
      typeof item === 'number' &&
      Number.isFinite(item) &&
      item >= 0 &&
      item <= 1
    )
      result.volume = item
    else if (key === 'repeatMode' && ['order', 'loop', 'single'].includes(String(item)))
      result.repeatMode = item as Preferences['repeatMode']
    else throw new Error(`不支持或无效的设置：${key}`)
  }
  return result
}
export function validateMediaState(value: unknown): DesktopMediaState {
  if (!value || typeof value !== 'object') throw new Error('播放信息无效')
  const v = value as Record<string, unknown>
  for (const key of ['title', 'artist'])
    if (typeof v[key] !== 'string' || (v[key] as string).length > 300)
      throw new Error('歌曲信息无效')
  for (const key of ['playing', 'canToggle', 'canNext', 'canPrevious'])
    if (typeof v[key] !== 'boolean') throw new Error('播放状态无效')
  if (v.roomId !== null && (typeof v.roomId !== 'string' || !/^[\w-]{1,128}$/.test(v.roomId)))
    throw new Error('房间信息无效')
  return {
    title: v.title as string,
    artist: v.artist as string,
    playing: v.playing as boolean,
    canToggle: v.canToggle as boolean,
    canNext: v.canNext as boolean,
    canPrevious: v.canPrevious as boolean,
    roomId: v.roomId as string | null,
  }
}
export function restoreWindow(
  saved: WindowGeometry | undefined,
  areas: { x: number; y: number; width: number; height: number }[],
): WindowGeometry {
  const primary = areas[0] || { x: 0, y: 0, width: 1280, height: 850 }
  const area =
    saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? areas.find(
          (a) =>
            saved.x! + 160 < a.x + a.width &&
            saved.x! + saved.width - 160 > a.x &&
            saved.y! + 100 < a.y + a.height &&
            saved.y! + saved.height - 100 > a.y,
        ) || primary
      : primary
  const width = Math.min(
    area.width,
    Math.max(Math.min(1000, area.width), Number.isFinite(saved?.width) ? saved!.width : 1280),
  )
  const height = Math.min(
    area.height,
    Math.max(Math.min(720, area.height), Number.isFinite(saved?.height) ? saved!.height : 850),
  )
  const x =
    saved && Number.isFinite(saved.x)
      ? Math.min(Math.max(saved.x!, area.x), area.x + area.width - width)
      : area.x + Math.round((area.width - width) / 2)
  const y =
    saved && Number.isFinite(saved.y)
      ? Math.min(Math.max(saved.y!, area.y), area.y + area.height - height)
      : area.y + Math.round((area.height - height) / 2)
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    maximized: saved?.maximized === true,
  }
}
