export const PROJECT_URL = 'https://github.com/tabidachinokaze/music-party'
export const PROJECT_LINKS = {
  repository: PROJECT_URL,
  releases: `${PROJECT_URL}/releases`,
  issues: `${PROJECT_URL}/issues`,
} as const
export type ProjectLink = keyof typeof PROJECT_LINKS
export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'
export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  version?: string
  releaseNotes?: string
  percent?: number
  transferred?: number
  total?: number
  message: string
}
export function updateSupport(
  packaged: boolean,
  platform: string,
  appImage?: string,
): string | null {
  if (!packaged) return '开发模式不执行安装更新，请使用发布的安装包。'
  if (platform === 'linux' && !appImage)
    return 'Linux 应用内更新需要直接运行 AppImage；解包目录请从发布页下载新版。'
  if (platform !== 'linux' && platform !== 'win32')
    return '此平台暂不支持应用内安装更新，请从 GitHub 发布页下载。'
  return null
}
export function plainReleaseNotes(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : Array.isArray(value)
        ? value
            .slice(0, 10)
            .map((item) => (typeof item?.note === 'string' ? item.note : ''))
            .join('\n')
        : ''
  return text
    .slice(0, 16000)
    .replace(/<[^>]*>/g, '')
    .slice(0, 8000)
}
