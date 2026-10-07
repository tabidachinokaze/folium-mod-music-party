# 官方多人一起听

本页使用原生网易云 URI。请求通过经过验证的 EAPI 传输，账号与校验 token 留在受控网络层，见 [transport-and-mini.md](transport-and-mini.md)。播放器交互和本地调度是参考方案，不是协议强制的 UI。

## 区分三种业务

- 官方多人分享：`https://st.music.163.com/listen-together/multishare/index.html?roomId=...&inviterUid=...&isFLT=false`。
- `/listen-together/share` 与 `listentogether_*` 属于双人；此前实测双人创建接口不能替代多人。
- `isFLT=true` 为跟听业务，预览为 `/api/follow/listen/room/info/h5`，不混入本技能的多人 ACK 与歌曲操作。

多人原生深链是 `orpheus://nm/multiListenTogether/joinRoom`，邀请者参数名为 `inviterId`。私信卡片可能用 `nativeUrl` 包装 `url1`（原生目标）、`url2`（网页后备）或 WebView `url`。逐层提取并严格验证官方域名、路由、唯一参数与有效 ID；不打开外层 URI，不根据昵称或说明文字拼造邀请。

预览接口只给房间展示信息，不证明本账号已加入。参考：[邀请解析](../../../vendor/music-party/src/shared/protocol.ts)、[私信卡片提取](../../../vendor/music-party/src/shared/private-messages.ts)。

## 端点与参数

| 用途         | 原生 URI                                            | 主要参数                                               |
| ------------ | --------------------------------------------------- | ------------------------------------------------------ |
| 分享预览     | `/api/listen/together/multi/landing/info/get`       | `roomId,inviterUid`                                    |
| 创建         | `/api/listen/together/multi/room/create`            | `type,songId,groupIds="[]",inviteUids="[]",checkToken` |
| 开始匹配     | `/api/listen/together/multi/match`                  | `songId,checkToken`                                    |
| 取消匹配     | `/api/listen/together/multi/match/cancel`           | 空参数                                                 |
| 确认加入     | `/api/listen/together/multi/match/ack`              | `roomId,inviterUid,agree=true,checkToken`              |
| 当前账号房间 | `/api/listen/together/multi/match/status/get`       | 空参数                                                 |
| 心跳         | `/api/listen/together/multi/match/heartbeat`        | `roomId`                                               |
| 已播歌曲     | `/api/listen/together/multi/match/played/song/list` | `roomId,sort=1,page`                                   |
| 完整待播     | `/api/listen/together/multi/match/wait/song/list`   | `roomId,page`                                          |
| 当前条目详情 | `/api/listen/together/multi/played/song/info`       | `roomId,songBizId`                                     |
| 歌曲操作     | `/api/listen/together/multi/match/song/operate`     | `roomId,songId,bizId,operate,checkToken`               |
| 离开         | `/api/listen/together/multi/match/exit`             | `roomId,exitType`                                      |
| 聊天历史     | `/api/listen/together/multi/match/msg/history`      | `roomId,direction=0,page`                              |
| 聊天发送     | `/api/middle/im/chatroom/send`                      | `chatroomId,msgType=0,clientExt,msgBody`               |

歌曲分页 `page=JSON.stringify({size:20,cursor:""})`，沿用 `data.page.more/cursor`；聊天参考实现 size=50。不能把对象直接代替字符串参数。

创建的 `type=1` 是私密好友房、`type=2` 是允许陌生人匹配的好友房；有效初始歌曲 ID 必须非零，0 曾实测返回 `MULTI_SONG_NOT_SATISFIED`。不要自动向 `inviteUids/groupIds` 填联系人。若产品有“匹配用歌曲”，创建和重新匹配在点击时固定这首歌，不因后台正在播放的歌曲变化而更换。

普通离开 `exitType=NORMAL_END`，退出再匹配使用 `CHANGE_ROOM`。停止本地同步、关闭窗口和服务端离开是不同操作；按目标产品的明确退出行为调用。

源码表：[multiEndpoints/multiPayload](../../../vendor/music-party/src/main/multi-api.ts)。

### 成功判据与权限

- 创建、加入、离开、开始匹配、退出再匹配：`data.success=true`。
- ADD/SWITCH/REDHEART：`data.failedCode=0`，REDHEART 还不能有 `data.result=false`。
- REMOVE/UP/LIKE：接受 `failedCode=0` 或 `result=true`，但明确 `result=false` 仍失败。
- ACK 返回 `data.multiLtRoomSnapshot.roomId` 必须匹配请求房间。
- 删除/点赞/红心前查询当前状态；删除还要核实完整待播里的推荐者 UID，禁止删除当前歌曲或他人的推荐。
- 房间失效 488、登录失效 301/302 不能按一般暂时错误继续提交旧写操作。收到“账号已在房间”失败时重新读状态，允许展示并恢复实际房间，不只显示错误后清空恢复入口。

这些是 [ApiService](../../../vendor/music-party/src/main/service.ts) 已接入的确认与防护，不等于所有端点都采用相同成功结构。

## 匹配需要通知后的 ACK

先登录音乐 Mini 通道再发起匹配。监听 outer `msgType=132/133`、`bizType=music_listenTogether_multi_match_song`，解析 `serverExt`：

- `subType=STRANGER_MULTI_MATCH_WAIT_ACK`，`data.roomId` 是待确认房间。
- `subType=STRANGER_MULTI_MATCH_FAILED`，读取 `data.failedType`。
- 待确认后调用 ACK；当前匹配实现 `inviterUid="0"`，`agree=true`。只有返回对应房间快照才转入房间。

通知可能先于开始匹配 HTTP 的返回，先暂存，等返回 `startMatchTimeMills` 后用**服务端时间**过滤旧通知。`maxWaitTimeMills` 单位毫秒。确认请求有独立时限，避免通知接近匹配截止时被旧定时器取消。

状态轮询只可恢复已确认的 `RECONNECT_SUCCESS` 房间，不能把待 ACK 通知替换成“轮询直到有房间”。取消、重试和账号变化使用不同 generation，禁止旧通知确认新一次匹配。

参考：[通知解析](../../../src/shared/match-notice.ts)、[匹配状态机](../../../src/client/room-match.ts)、[提前到达通知缓冲](../../../src/client/match-channel.ts)。其中连接对象属于参考项目；协议流程不要求同名类。

## 快照、房间类型与时间单位

`multiLtRoomSnapshot` 中：

| 字段                                                         | 含义                             |
| ------------------------------------------------------------ | -------------------------------- |
| `roomId`                                                     | 多人业务房间 ID                  |
| `multiRoomInfoDTO.chatRoomId`                                | IM 聊天室 ID，与 roomId 不同     |
| `multiRoomInfoDTO.roomBizType`                               | 房间业务类型                     |
| `multiLtRoomUserAgg.onlineNums/onlineUserInfos`              | 在线人数与成员资料               |
| `roomPlaySongInfo.playSong/nextSongs`                        | 当前歌曲与近期待播预览           |
| `roomPlaySongInfo.version/playedTime/songDuration/forceSync` | 版本、进度、时长、强制同步       |
| 歌曲 `songId/songBizId/songRcmdUid`                          | 曲目 ID、推荐条目 ID、推荐者 UID |

Android 属性 `roomInfo/roomUserList` 是别名；优先读取 JSON 的 `multiRoomInfoDTO/multiLtRoomUserAgg`。容错可以兼容别名，但不能用空的不同 DTO 覆盖正确字段。

`roomBizType`：1 私密好友房、2 公开好友房、3 公开匹配房，来自官方 `rn-tt-search` 的 `ROOM_TYPE`。2/3 允许陌生人匹配。缺失或未知类型保持未知，不能根据本地开关、`roomType` 或人数推测。界面可只显示类型名称；原始值用于诊断。

`heartBeatDuration` 单位**秒**；`playedTime/songDuration` 单位**毫秒**；播放器时间通常是秒，转换应集中处理。

估算采样时刻可取请求往返中点；随后 `目标进度=playedTime+(当前单调时刻-采样时刻)`，限制到歌曲时长。以版本和采样时刻拒绝过期响应，歌曲加载完成后再对齐。账号/房间/条目变化使旧加载失效。某个成员资料异常不能中断音乐。

参考：[parseSnapshot/targetPosition/shouldAccept](../../../vendor/music-party/src/shared/multiplayer.ts)。现实现房间歌曲与聊天尚未接入实时推送，使用心跳/状态/历史查询；不能因 Mini 已连接而省略它们。

## 队列与歌曲操作

同一歌曲可以被多次推荐；队列键是 `songBizId/bizId`，不能仅按 songId 去重。`nextSongs` 只是预览，完整队列要遍历待播分页，检查重复游标；`data.songLists[]` 的 `songInfo.resourceId/bizId/title/artistName/coverUrl` 与 `rcmdUid/nickname` 提供条目和推荐者。

| operate | 含义              | 参数差异                               |
| ------- | ----------------- | -------------------------------------- |
| 0       | JOIN（官方枚举）  | 本实现没有作为歌曲操作发送，入房走 ACK |
| 1       | ADD 推歌          | `songId`，`bizId="0"`                  |
| 2       | UP 置顶           | 真实 songId + bizId，不在本地伪造排序  |
| 3       | LIKE 点赞         | 核实当前播放业务条目；允许重复点赞     |
| 4       | SWITCH 切歌       | 当前条目的真实 songId + bizId          |
| 5       | REDHEART 红心动态 | 当前条目的真实 songId + bizId          |
| 7       | REMOVE 删除推荐   | 核实当前账号是推荐者，且该条目仍待播   |

普通个人“喜欢”与房间 REDHEART 是两步：先由项目确认个人收藏成功，再在账号/房间/当前条目仍匹配、非试听且是新增收藏时发 REDHEART。取消收藏不发；红心动态失败不回滚已经成功的个人收藏，不伪造聊天里的“某用户红心了”。服务端生成真实活动，随后由聊天读取显示。

推荐者缺失或 UID 为系统值时，不假造普通用户；项目可以显示“系统推荐”。已播统计按业务条目去重，不能用当前歌曲的点赞总数替代所有条目。

“播放用于本地试听，加入队列才推歌”是本项目产品约定，移植时要显式决定交互含义。协议层 ADD 不意味着立即切歌。多人进度由服务端决定，本机暂停/恢复/试听不发送双人 PLAY/PAUSE/seek 指令；自然结束查询服务器状态，用户主动下一首才发 SWITCH。

## 房间聊天

从已认证当前快照解析 `chatRoomId`，发送前确认 roomId 未变；不信任前端任意传来的 IM 聊天室。

```js
const payload = {
  chatroomId: chatRoomId,
  msgType: 0,
  clientExt: JSON.stringify({
    bizType: 'listenTogether',
    ltType: 'MULTI_MATCH_SONG',
    roomId,
    // 图片/表情时加 emoji；普通文本不填。
  }),
  msgBody: JSON.stringify({ msg: text, msgType: 0 }),
}
```

历史 `data.records` 中有 `sendUid/sendTime/nickname/avatarUrl/msgType/imChatRoomMsgBody`；文字在 `imChatRoomMsgBody.text`。普通消息 0、互动 1、推歌 2、通用通知 3；普通消息也可以附带 emoji。以发送者和时间等业务字段去重，过滤其他房间以及 `onlyCanSeeUserIds` 不含本账号的记录。

当前文本限制 100 个 UTF-16 单位；405 为发送频率限制，407 为内容拒绝。失败保留草稿、超时不自动重发。@ 使用官方 `@昵称` 文字，接收时基于实际完整昵称判断，不猜造未核实的额外协议。

参考：[chat.ts](../../../vendor/music-party/src/shared/chat.ts)，图片/表情参数见 [media-and-stickers.md](media-and-stickers.md)。
