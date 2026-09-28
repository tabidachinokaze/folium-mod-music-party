// Protocol fields verified in the official multi-listen Android client linked by its share page.
// This table is deliberately closed: the renderer cannot choose arbitrary upstream endpoints.
export const multiEndpoints = {
  multiPreview: '/api/listen/together/multi/landing/info/get',
  multiCreate: '/api/listen/together/multi/room/create',
  multiJoin: '/api/listen/together/multi/match/ack',
  multiStatus: '/api/listen/together/multi/match/status/get',
  multiHeartbeat: '/api/listen/together/multi/match/heartbeat',
  multiQueue: '/api/listen/together/multi/match/wait/song/list',
  multiSongInfo: '/api/listen/together/multi/played/song/info',
  multiRemove: '/api/listen/together/multi/match/song/operate',
  multiUp: '/api/listen/together/multi/match/song/operate',
  multiLike: '/api/listen/together/multi/match/song/operate',
  multiAdd: '/api/listen/together/multi/match/song/operate',
  multiNext: '/api/listen/together/multi/match/song/operate',
  multiLeave: '/api/listen/together/multi/match/exit',
  multiChatHistory: '/api/listen/together/multi/match/msg/history',
  multiChatSend: '/api/middle/im/chatroom/send',
} as const
export type MultiMethod = keyof typeof multiEndpoints
export function multiPayload(method: MultiMethod, args: Record<string, unknown>, checkToken = '') {
  const roomId = args.roomId
  switch (method) {
    case 'multiCreate':
      return { type: 1, songId: args.songId, groupIds: '[]', inviteUids: '[]', checkToken }
    case 'multiJoin':
      return { roomId, inviterUid: args.inviterUid, agree: true, checkToken }
    case 'multiPreview':
      return { roomId, inviterUid: args.inviterUid }
    case 'multiStatus':
      return {}
    case 'multiChatHistory':
      return {
        roomId,
        direction: 0,
        page: JSON.stringify({ size: 50, ...(args.cursor ? { cursor: args.cursor } : {}) }),
      }
    case 'multiChatSend':
      return {
        chatroomId: args.chatRoomId,
        msgType: 0,
        clientExt: JSON.stringify({
          bizType: 'listenTogether',
          ltType: 'MULTI_MATCH_SONG',
          roomId,
          ...(args.emoji ? { emoji: args.emoji } : {}),
        }),
        msgBody: JSON.stringify({ msg: args.text, msgType: 0 }),
      }
    case 'multiHeartbeat':
      return { roomId }
    case 'multiQueue':
      return { roomId, page: JSON.stringify({ size: 20, cursor: args.cursor || '' }) }
    case 'multiSongInfo':
      return { roomId, songBizId: args.bizId }
    case 'multiRemove':
    case 'multiUp':
    case 'multiLike':
      return {
        roomId,
        songId: args.songId,
        bizId: args.bizId,
        operate: { multiRemove: 7, multiUp: 2, multiLike: 3 }[method],
        checkToken,
      }
    case 'multiLeave':
      return { roomId, exitType: 'NORMAL_END' }
    case 'multiAdd':
      return { roomId, songId: args.songId, bizId: '0', operate: 1, checkToken }
    case 'multiNext':
      return { roomId, songId: args.songId, bizId: args.bizId, operate: 4, checkToken }
  }
}
export const multiMutations = new Set([
  'multiCreate',
  'multiJoin',
  'multiAdd',
  'multiNext',
  'multiLeave',
  'multiChatSend',
  'multiRemove',
  'multiUp',
  'multiLike',
])
