import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// tests/server.mjs
// All protocol writes in browser tests terminate here, never at NetEase.
const port = 4176,
  origin = `http://127.0.0.1:${port}`
const clientBuild = await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  write: false,
  loader: { '.css': 'text' },
  plugins: [
    {
      name: 'mock-official-notification-transport',
      setup(builder) {
        builder.onResolve({ filter: /\/match-sdk$/ }, () => ({
          path: fileURLToPath(new URL('match-sdk.mjs', import.meta.url)),
        }))
      },
    },
  ],
})
const sdkProbe = await build({
  entryPoints: ['src/client/match-sdk.ts'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  write: false,
})
const require = createRequire(import.meta.url)
const activate = require('../dist/music-party/index.cjs')
let handlers = new Map(),
  dispose = [],
  current = '1',
  version = 1,
  joined = true,
  matching = false,
  matchMode = 'pending',
  notificationSent = false,
  chatPages = false,
  removed = new Set(),
  calls = [],
  messages = [],
  unread = 1,
  likes = 0,
  operations = [],
  promoted = null,
  privatePages = false,
  deletedStickers = new Set()
const self = { userId: 9, nickname: '晚风' },
  peer = { userId: 10, nickname: '小岛', avatarUrl: 'https://p1.music.126.net/fixture/avatar.jpg' }
function reset() {
  dispose.forEach((fn) => fn())
  handlers = new Map()
  dispose = []
  activate({
    rpc: { handle: (name, fn) => handlers.set(name, fn) },
    lifecycle: { onDeactivate: (fn) => dispose.push(fn) },
  })
  matching = false
  matchMode = 'pending'
  notificationSent = false
  chatPages = false
  current = '1'
  version = 1
  joined = true
  removed = new Set()
  calls = []
  messages = []
  unread = 1
  likes = 0
  operations = []
  promoted = null
  privatePages = false
  deletedStickers = new Set()
}
reset()
const rawSong = (id) => ({
  id: Number(id),
  name: id === '1' ? '晚风与海' : `下一站 · ${id}`,
  ar: [{ id: 1, name: '岛屿来信' }],
  al: { id: 1, name: '沿途', picUrl: `${origin}/cover.svg` },
  dt: 30000,
  fee: 0,
  privilege: { st: 0, pl: 320000, fl: 320000 },
})
const snapshot = () => ({
  roomId: 'official_room',
  multiLtRoomUserAgg: {
    onlineNums: 3,
    onlineUserInfos: [
      { uid: 9, nickname: '晚风', avatar: `${origin}/cover.svg` },
      { uid: 10, nickname: '小岛', avatar: `${origin}/cover.svg` },
      { uid: 11, nickname: '远山', avatar: `${origin}/cover.svg` },
    ],
  },
  multiRoomInfoDTO: { chatRoomId: '888' },
  roomPlaySongInfo: {
    playSong: { songId: current, songBizId: `10${version}`, songRcmdUid: '9' },
    version,
    playedTime: 5000,
    songDuration: 30000,
    nextSongs: [],
    waitSongCount: 9 - removed.size,
    playingSongZanCnt: likes,
  },
})
const privateMessage = () => ({
  id: 1,
  fromUser: peer,
  toUser: self,
  time: 1790600000000,
  msg: JSON.stringify({
    msg: '一起听这首吧',
    type: 1,
    nativeUrl:
      'https://st.music.163.com/listen-together/multishare/index.html?roomId=official_room&inviterUid=10&isFLT=false',
  }),
})
const wave = Buffer.alloc(44 + 8000 * 2 * 30)
wave.write('RIFF')
wave.writeUInt32LE(wave.length - 8, 4)
wave.write('WAVEfmt ', 8)
wave.writeUInt32LE(16, 16)
wave.writeUInt16LE(1, 20)
wave.writeUInt16LE(1, 22)
wave.writeUInt32LE(8000, 24)
wave.writeUInt32LE(16000, 28)
wave.writeUInt16LE(2, 32)
wave.writeUInt16LE(16, 34)
wave.write('data', 36)
wave.writeUInt32LE(wave.length - 44, 40)
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', '*')
  if (req.method === 'OPTIONS') {
    res.end()
    return
  }
  const url = new URL(req.url, origin)
  const json = (body) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(body))
  }
  try {
    let body = ''
    for await (const chunk of req) body += chunk
    const args = body ? JSON.parse(body) : Object.fromEntries(url.searchParams)
    if (url.pathname === '/test/reset') {
      reset()
      return json({ ok: true })
    }
    if (url.pathname === '/test/private-pages') {
      privatePages = true
      return json({ ok: true })
    }
    if (url.pathname === '/test/state')
      return json({ calls, current, version, joined, matching, likes, operations })
    if (url.pathname === '/test/match-mode') {
      matchMode = args.value
      return json({ ok: true })
    }
    if (url.pathname === '/test/chat-pages') {
      chatPages = true
      return json({ ok: true })
    }
    if (url.pathname === '/test/match-notification') {
      if (!matching || notificationSent || matchMode === 'pending') return json({})
      notificationSent = true
      return json({
        receiverId: '9',
        timestamp: Date.now(),
        content: JSON.stringify({
          msgType: 133,
          bizType: 'music_listenTogether_multi_match_song',
          serverExt: JSON.stringify({
            subType:
              matchMode === 'success'
                ? 'STRANGER_MULTI_MATCH_WAIT_ACK'
                : 'STRANGER_MULTI_MATCH_FAILED',
            data:
              matchMode === 'success' ? { roomId: 'official_room' } : { failedType: 'NO_MATCH' },
          }),
        }),
      })
    }
    if (url.pathname === '/test/empty') {
      joined = false
      return json({ ok: true })
    }
    if (url.pathname === '/rpc') {
      try {
        return json({ ok: true, result: await handlers.get(args.name)(...args.args) })
      } catch (error) {
        return json({ ok: false, error: error.message })
      }
    }
    if (url.pathname === '/sdk-probe.mjs') {
      res.setHeader('Content-Type', 'text/javascript')
      return res.end(sdkProbe.outputFiles[0].text)
    }
    if (url.pathname === '/client.mjs') {
      res.setHeader('Content-Type', 'text/javascript')
      return res.end(clientBuild.outputFiles[0].text)
    }
    if (url.pathname === '/harness.mjs') {
      res.setHeader('Content-Type', 'text/javascript')
      return res.end(await readFile(new URL('harness.mjs', import.meta.url)))
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.setHeader('Content-Type', 'text/html')
      return res.end(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Music Party test host</title><style>body{margin:0;background:#101112;color:#e9e5e5;font-family:system-ui,sans-serif}#private-home{height:calc(100vh - 60px);box-sizing:border-box;padding:16px 48px}#panel{box-sizing:border-box;width:320px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 76px);padding:20px;margin:24px auto;background:#ffffff03;border-radius:24px;overflow-y:auto;scrollbar-width:none}@media(max-width:640px){#private-home{padding:12px 16px}}</style><div id="panel"></div><script type="module" src="/harness.mjs"></script></html>',
      )
    }
    if (url.pathname === '/cover.svg') {
      res.setHeader('Content-Type', 'image/svg+xml')
      return res.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#315f61"/><circle cx="60" cy="40" r="20" fill="#ced7b4"/></svg>',
      )
    }
    if (url.pathname === '/audio.wav') {
      const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/)
      res.setHeader('Content-Type', 'audio/wav')
      res.setHeader('Accept-Ranges', 'bytes')
      if (range) {
        const start = Number(range[1]),
          end = range[2] ? Number(range[2]) : wave.length - 1
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${wave.length}`)
        return res.end(wave.subarray(start, end + 1))
      }
      return res.end(wave)
    }
    if (url.pathname === '/login/status') return json({ code: 200, data: { profile: self } })
    if (url.pathname === '/user/account')
      return json({ code: 200, account: { id: 9 }, profile: self })
    if (url.pathname === '/register/checktoken/v3')
      return json({ code: 200, token: 'fixture-token' })
    if (url.pathname === '/song/detail')
      return json({ code: 200, songs: [rawSong(args.ids || current)] })
    if (url.pathname === '/song/url/v1' || url.pathname === '/song/url')
      return json({
        code: 200,
        data: [
          {
            id: Number(args.id),
            url: `${origin}/audio.wav?id=${args.id}`,
            level: 'standard',
            type: 'wav',
          },
        ],
      })
    if (url.pathname === '/lyric/new' || url.pathname === '/lyric')
      return json({
        code: 200,
        lrc: {
          lyric: '[00:00.00]晚风轻轻经过\n[00:05.00]让我们听同一首歌\n[00:15.00]远山和海都在这里',
        },
      })
    if (url.pathname === '/cloudsearch')
      return json({ code: 200, result: { songs: [rawSong('20')], songCount: 1 } })
    if (url.pathname === '/msg/private') {
      calls.push(`contacts:${args.offset || 0}`)
      const offset = Number(args.offset || 0)
      return json({
        code: 200,
        msgs: Array.from({ length: privatePages ? 20 : 1 }, (_, i) => ({
          fromUser:
            offset + i
              ? { ...peer, userId: 10 + offset + i, nickname: `听友 ${offset + i}` }
              : peer,
          toUser: self,
          lastMsg: '{"msg":"一起听歌吧"}',
          lastMsgTime: 1790600000000 - i,
          newMsgCount: offset + i ? 0 : unread,
        })),
        more: privatePages && offset === 0,
      })
    }
    if (url.pathname === '/msg/private/history') {
      calls.push(`history:${args.uid}:${args.before || 0}`)
      if (!privatePages) return json({ code: 200, msgs: [privateMessage()], more: false })
      const before = Number(args.before || 1790600000001)
      const msgs = Array.from({ length: 25 }, (_, i) => ({
        ...privateMessage(),
        id: before - i - 1,
        time: before - i - 1,
        fromUser: { ...peer, userId: Number(args.uid) },
        msg: JSON.stringify({ msg: `消息 ${before - i - 1}`, type: 1 }),
      }))
      if (!args.before)
        msgs[0].msg = JSON.stringify({
          msg: '图片',
          pics: [{ url: 'https://p1.music.126.net/fixture/photo.jpg' }],
        })
      return json({ code: 200, msgs, more: !args.before })
    }
    if (url.pathname === '/send/text') {
      calls.push('privateSend')
      return json({ code: 200, data: true })
    }
    if (url.pathname === '/api') {
      const data = typeof args.data === 'string' ? JSON.parse(args.data) : args.data || {},
        uri = args.uri
      calls.push(uri)
      if (uri.endsWith('/im/token/get'))
        return json({ code: 200, data: { accId: '9', token: 'fake-test-token' } })
      if (uri.endsWith('/multi/match')) {
        notificationSent = false
        matching = true
        return json({ code: 200, data: { success: true } })
      }
      if (uri.endsWith('/match/cancel')) {
        matching = false
        return json({ code: 200 })
      }
      if (uri.endsWith('/status/get'))
        return json({
          code: 200,
          data: {
            status: joined ? 'RECONNECT_SUCCESS' : matching ? 'MATCHING' : 'IDLE',
            multiLtRoomSnapshot: joined ? snapshot() : null,
          },
        })
      if (uri.endsWith('/heartbeat'))
        return json({ code: 200, data: { ...snapshot(), heartBeatDuration: 5 } })
      if (uri.endsWith('/room/create') || uri.endsWith('/match/ack')) {
        matching = false
        joined = true
        return json({ code: 200, data: { success: true, multiLtRoomSnapshot: snapshot() } })
      }
      if (uri.endsWith('/match/exit')) {
        joined = false
        return json({ code: 200, data: { success: true } })
      }
      if (uri.endsWith('/wait/song/list')) {
        const page = JSON.parse(data.page),
          start = Number(page.cursor || 0)
        const rows = Array.from({ length: 9 }, (_, i) => ({
          songInfo: {
            resourceId: String(i === 8 ? 2 : i + 2),
            bizId: String(i + 200),
            title: `待播歌曲 ${i + 1}`,
            artistName: ['岛屿来信'],
            coverUrl: `${origin}/cover.svg`,
          },
          rcmdUid: i % 2 ? '10' : '9',
          nickname: i % 2 ? '小岛' : '晚风',
        }))
          .filter((row) => !removed.has(row.songInfo.bizId))
          .sort(
            (a, b) => Number(b.songInfo.bizId === promoted) - Number(a.songInfo.bizId === promoted),
          )
        return json({
          code: 200,
          data: {
            songLists: rows.slice(start, start + 4),
            page: { more: start + 4 < rows.length, cursor: String(start + 4) },
          },
        })
      }
      if (uri.endsWith('/played/song/list')) {
        calls.push('playedSongs')
        const start = Number(JSON.parse(data.page).cursor || 0)
        const rows = Array.from({ length: 5 }, (_, i) => ({
          songInfo: {
            resourceId: '2',
            bizId: String(700 + i),
            title: `已播歌曲 ${i + 1}`,
            artistName: ['歌手'],
            zanCnt: i + 3,
          },
          rcmdUid: i % 2 ? '10' : '9',
        }))
        return json({
          code: 200,
          data: {
            songLists: rows.slice(start, start + 2),
            page: { more: start + 2 < rows.length, cursor: String(start + 2) },
          },
        })
      }
      if (uri.endsWith('/song/operate')) {
        calls.push(`operate:${data.operate}`)
        operations.push(data)
        if (data.operate === 3) likes++
        if (data.operate === 2) promoted = data.bizId
        if (data.operate === 4) {
          current = String(Number(current) + 1)
          version++
        }
        if (data.operate === 7) removed.add(data.bizId)
        return json({ code: 200, data: { failedCode: 0 } })
      }
      if (uri.endsWith('/msg/history') && chatPages) {
        const older = !!JSON.parse(data.page || '{}').cursor
        calls.push(older ? 'chat:older' : 'chat:latest')
        const records = Array.from({ length: older ? 30 : 50 }, (_, index) => {
          const n = index + (older ? 0 : 30)
          return {
            sendUid: '10',
            sendTime: 1790600000000 + n * 1000,
            nickname: '小岛',
            msgType: n === 75 ? 1 : 0,
            imChatRoomMsgBody: { text: n === 75 ? '为歌曲点赞' : `聊天消息 ${n}` },
          }
        })
        return json({
          code: 200,
          data: { records, page: { more: !older, cursor: older ? null : 'older-1' } },
        })
      }
      if (uri.endsWith('/msg/history'))
        return json({
          code: 200,
          data: {
            records: [
              {
                sendUid: '10',
                sendTime: 1790600000000,
                nickname: '小岛',
                msgType: 0,
                imChatRoomMsgBody: { text: '这首歌适合在海边听。' },
              },
              ...messages,
            ],
            page: { more: false },
          },
        })
      if (uri.endsWith('/chatroom/send')) {
        const text = JSON.parse(data.msgBody).msg
        if (text === 'REJECT') return json({ code: 405, message: '发送太频繁，请稍后重试' })
        messages.push({
          sendUid: '9',
          sendTime: Date.now(),
          nickname: '晚风',
          msgType: 0,
          imChatRoomMsgBody: { text },
        })
        return json({ code: 200, data: { success: true } })
      }
      if (uri.endsWith('/count/clean')) {
        unread = 0
        return json({ code: 200, data: true })
      }
      if (uri.endsWith('/emoji/cancel')) {
        const ids = JSON.parse(args.data.emojiIds)
        ids.forEach((id) => deletedStickers.add(String(id)))
        calls.push('stickerDelete')
        return json({ code: 200, data: { result: true } })
      }
      if (uri.endsWith('/emoji/groups'))
        return json({
          code: 200,
          data: { emojiGroups: [{ id: '1', name: '我的表情', edit: true }] },
        })
      if (uri.endsWith('/detail/page'))
        return json({
          code: 200,
          data: {
            emojis: deletedStickers.has('1')
              ? []
              : [
                  {
                    emojiId: '1',
                    emojiGroupId: '1',
                    emojiImgUrl: 'https://p1.music.126.net/fixture/1.jpg',
                    emojiName: '开心',
                    width: 100,
                    height: 100,
                    format: 'jpg',
                  },
                ],
            page: { more: false },
          },
        })
    }
    json({
      code: 200,
      data: [],
      playlist: [],
      ids: [],
      songs: [],
      result: { songs: [], songCount: 0 },
    })
  } catch (error) {
    res.statusCode = 500
    json({ error: error.message })
  }
})
server.listen(port, '127.0.0.1', () => console.log(`Test API and harness: ${origin}`))
