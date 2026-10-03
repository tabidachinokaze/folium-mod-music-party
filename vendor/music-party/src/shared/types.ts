import type { ProjectLink, UpdateState } from './updates'
import type { DesktopInfo, DesktopMediaState, PlayerCommand, Preferences } from './desktop'
import type { MediaRequest, MediaReply, MediaProgress } from './media'
export type Method =
  | 'account'
  | 'qrCreate'
  | 'qrCheck'
  | 'logout'
  | 'search'
  | 'song'
  | 'stream'
  | 'playlists'
  | 'playlist'
  | 'albums'
  | 'album'
  | 'likes'
  | 'like'
  | 'lyrics'
  | 'artistSongs'
  | 'multiPreview'
  | 'multiMatch'
  | 'multiMatchCancel'
  | 'multiRematchLeave'
  | 'multiCreate'
  | 'multiJoin'
  | 'multiStatus'
  | 'multiHeartbeat'
  | 'multiQueue'
  | 'multiPlayed'
  | 'multiSongInfo'
  | 'multiRemove'
  | 'multiUp'
  | 'multiLike'
  | 'multiAdd'
  | 'multiNext'
  | 'multiLeave'
  | 'multiChatHistory'
  | 'multiChatSend'
  | 'privateConversations'
  | 'privateHistory'
  | 'privateRead'
  | 'privateSend'
  | 'privateInvite'
  | 'privateSticker'
  | 'stickerGroups'
  | 'stickerPage'
  | 'follows'
export interface Request {
  method: Method
  args?: Record<string, unknown>
}
export interface Trace {
  id: number
  time: string
  method: string
  duration: number
  ok: boolean
  request: unknown
  response: unknown
}
export interface Reply {
  ok: boolean
  data?: any
  error?: string
  code?: number
  deliveryUnknown?: boolean
  trace?: Trace
}
export interface Bridge {
  call(request: Request): Promise<Reply>
  onTrace(callback: (trace: Trace) => void): () => void
  exportTrace(): Promise<boolean>
  sessionInfo(): Promise<{ persistent: boolean; reason: string; version: string }>
  copy(text: string): Promise<void>
  openProject(link: ProjectLink): Promise<void>
  openMessageLink(url: string): Promise<void>
  sendMedia(request: MediaRequest): Promise<MediaReply>
  cancelMedia(requestId: string): Promise<void>
  onMediaProgress(callback: (progress: MediaProgress) => void): () => void
  requestMicrophone(): Promise<void>
  updateState(): Promise<UpdateState>
  updateAction(action: 'check' | 'download' | 'install'): Promise<UpdateState>
  onUpdate(callback: (state: UpdateState) => void): () => void
  desktopInfo(): Promise<DesktopInfo>
  setFullScreen(value: boolean | 'toggle'): Promise<DesktopInfo>
  updatePreferences(value: Partial<Preferences>): Promise<DesktopInfo>
  updateMedia(value: DesktopMediaState): Promise<void>
  quit(): Promise<void>
  onDesktopInfo(callback: (info: DesktopInfo) => void): () => void
  onPlayerCommand(callback: (command: PlayerCommand) => void): () => void
  onLifecycle(callback: (event: 'suspend' | 'resume') => void): () => void
}
export interface Song {
  id: string
  name: string
  artist: string
  album: string
  cover: string
  duration: number
}
export interface Album {
  id: string
  name: string
  cover: string
  artist: string
  count: number
}
export interface MultiInvitation {
  roomId: string
  inviterUid: string
  isFLT: false
}
export interface Room {
  roomId: string
  inviterUid: string
  role: 'host' | 'guest' | 'unknown'
  chatRoomId?: string | null
}
export interface QueueSong {
  songId: string
  songBizId: string
  songRcmdUid: string
}
export interface RoomQueueEntry extends QueueSong {
  track: Song
  recommender: string
  selfRecommended: boolean
  uped: boolean
  upCount: number
  liked: boolean
  likeCount: number
}
export interface RoomPlayback {
  song: QueueSong | null
  nextSongs: QueueSong[]
  version: number
  playedTime: number
  duration: number
  sampledAt: number
  forceSync: boolean
  waitSongCount: number
  likeCount?: number
}
export interface Member {
  uid: string
  nickname: string
  avatar: string
}
export interface RoomSnapshot {
  creatorId?: string
  createdAt?: number
  tags?: string[]
  roomId: string
  playback: RoomPlayback | null
  members: Member[]
  membersKnown: boolean
  onlineCount: number | null
  chatRoomId: string | null
}
declare global {
  interface Window {
    together: Bridge
  }
}

export interface Playlist {
  id: string
  name: string
  cover: string
  count: number
  creatorId: string
  creator: string
  specialType: number
}
export interface Artist {
  id: string
  name: string
  cover: string
  aliases: string[]
}
export type SearchKind = 'songs' | 'playlists' | 'artists'

export interface ChatMessage {
  id: string
  roomId: string
  uid: string
  nickname: string
  avatar: string
  time: number
  text: string
  kind: 'text' | 'notice' | 'image' | 'resource' | 'interaction'
  attachments?: MessageAttachment[]
  richText?: MessageTextPart[]
  emoji?: ChatEmoji
  delivery?: 'sending' | 'submitted' | 'failed' | 'uncertain'
  error?: string
  echoAfter?: number
}
export interface ChatPage {
  messages: ChatMessage[]
  more: boolean
  cursor: string | null
}

export interface Conversation {
  uid: string
  nickname: string
  avatar: string
  preview: string
  time: number
  unread: number
}
export interface PrivateMessage {
  id: string
  senderId: string
  recipientId: string
  time: number
  text: string
  invitations: MultiInvitation[]
  attachments?: MessageAttachment[]
  richText?: MessageTextPart[]
  delivery?: 'sending' | 'submitted' | 'failed' | 'uncertain'
  error?: string
  echoAfter?: number
}
export interface ChatEmoji {
  emojiId: string
  emojiGroupId: string
  emojiName: string
  emojiImgUrl: string
  width: number
  height: number
  format: string
}
export interface MessageTextPart {
  text: string
  emphasized: boolean
  url?: string
}
export interface MessageAttachment {
  kind: 'image' | 'audio' | 'video' | 'resource' | 'file'
  title: string
  subtitle?: string
  artist?: string
  label?: string
  url?: string
  cover?: string
  resourceType?: string
  resourceId?: string
  actionUrl?: string
  emoji?: ChatEmoji
}
export interface PrivatePage {
  messages: PrivateMessage[]
  more: boolean
  before: number | null
}
