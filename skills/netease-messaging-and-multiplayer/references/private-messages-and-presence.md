# 私信、通知对话与在线状态

先读 [transport-and-mini.md](transport-and-mini.md) 了解加密入口、账号隔离与缓存绕过。本页中的时间间隔和 UI 行为是参考实现策略，移植时可按产品需求调整。

## 私信读取和发送接口

| 用途                | NCM 封装 / 原生 URI                                | 参数与主要响应                                                             |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| 会话列表            | `msg_private` → `/api/msg/private/users`           | `offset,limit,total`；`msgs[]`、`more`                                     |
| 历史                | `msg_private_history` → `/api/msg/private/history` | 封装 `uid,before,limit` → `userId,time,limit,total`；`msgs[]`              |
| 文字私信            | `send_text` → `/api/msg/private/send`              | 封装 `user_ids,msg` → `type=text,userIds=[单个UID],msg`                    |
| 单会话已读          | EAPI `/api/communication/msg/unread/count/clean`   | `userId`；检查业务响应后再清除本地未读                                     |
| 图片/表情等现代消息 | EAPI `/api/communication/send/msg`                 | `sendMsgBody` JSON 字符串 + `checkToken`；确认 `data.msgBody.msgId/status` |

封装库可能返回另一层 `data`，解析时区分官方 body、API 封装 body 和本项目的 RPC reply。

会话用 `fromUser`/`toUser` 与当前登录 UID 判断对端；不要把发件人固定当作联系人。最新消息是 `lastMsg`，时间 `lastMsgTime`，未读 `newMsgCount`。

历史有 `fromUser`、`toUser`、`time`、`id`、`msg`，也可能有 `body/msgBody/msgType/nativeUrl`。只接受双方确实属于当前会话的记录，按服务端 ID 去重、时间排序；缺少 ID 的降级键不能充当权威已读依据。历史向前分页使用最早时间，避免游标不前进导致重复请求。

旧 `msg.type` 与新 `msgType` 不是同一枚举。`msg/body/msgBody` 都可能是 JSON 字符串，要在有层数/长度限制的解析后再判断类型。

## 实时私信业务链

已静态定位并用真实账号验证：

```text
Mini CustomNotification
  → content JSON：msgType 132/133
  → bizType = music_communication_realtime_msg_notice
  → serverExt（对象或 JSON 字符串）
  → data：Base64
  → GZIP 解压
  → RawMessage JSON
  → scene=1 的私信会话
```

RawMessage 关键字段：`channelId`（会话对端）、`scene`、`senderUserId`、`targetUserList`、`clientUiFlag`、`msgBody`。正文元数据在 `msgBody.msgId/msgType/msgTime/text.textBody/briefText`；发送者资料通常是 `msgBody.sender.user`，保留旧的平铺 sender 兼容。

解析规则：

- `scene` 必须为 1；`channelId` 应是有效对端 UID。`targetUserList` 若非空，必须包含当前账号。
- `msgId` 保持原始精度。业务去重键可由会话、消息 ID、类型组成；命令更新可能复用 ID，要额外区分正文摘要。
- `msgType=99` 或 `clientUiFlag=false` 作为变更事件，不应生成新私信 toast。
- sender 资料 ID 与实际发送者不一致时，不用它冒充头像和昵称；自身消息同步不产生“好友新消息”提醒。
- Base64、压缩输入与解压输出分别设上限。当前实现上限为 768 KiB envelope、256 KiB 压缩内容、512 KiB 解压输出；非法包返回无事件。

容易误判的旁路：`music_communication_retrieve_msg_notice` 在该 APK 中是 log salvage，**不是撤回消息接口**；`PUSH_MSG_ARRIVED` 只刷新计数行，不是正文推送。旧 `MusicIMManager` 或 `music_privateMsg` 路径也不能直接替代已实测的 RawMessage 通路。

独立实现：[parsePrivateNotice](../../../src/main/private-notice.ts)。静态入口：`MainActivity.B8` → `ACTION_FETCH_CHAT_OBSERVER` → `ChatIMManager.onMessageReceived`，详见 [研究与验证](research-and-validation.md)。

## 消息内容、卡片与“升级 App”占位

现代消息类型：图片 1、资源卡片 2、语音 4、视频 5、歌曲 30/31、歌单 32、专辑 35，其他资源 33–48、文件 49。这些值不能套用到旧 `msg.type`。

“（升级App到最新版本即可查看该消息）”可能只是兼容正文；先检查结构化 body、图片或表情元数据。若附件可正常展示，按内容规则省略重复占位；没有可解析内容时保留未知类型提示，不能一律隐藏。

音乐卡片以确切资源 ID/类型识别，支持嵌套 `nativeUrl`、`url1/url2/url`、JSON 包装和经过验证的官方深链。歌曲和专辑的封面/歌手/关联专辑属于该卡片，不另渲染成一条可收藏聊天图片。优先确定歌曲/专辑目标，再走一般链接后备；执行项目自己的资源打开行为，不执行任意 URI 或消息 HTML。

多人邀请提取的是 [multiplayer.md](multiplayer.md) 中的严格官方路由。仅有“一起听”描述文字不能推测出房间。

参考：[消息内容](../../../vendor/music-party/src/shared/message-content.ts)、[资源目标](../../../vendor/music-party/src/shared/message-action.ts)、[会话与历史](../../../vendor/music-party/src/shared/private-messages.ts)。

## 发送、后台接收与已读边界

参考实现限制文字为 500 个 UTF-16 单位、每次一个收件人；发送前校验登录账号和对端，拒绝给自己发送。确认发送后才收起或清空草稿；超时标记结果未知并查询历史，不自动重发。

`requestId` 是客户端 UUID，用于本进程同一请求去重；现代 `msgBody.unikey` 沿用它。没有证据证明所有上游端点提供跨进程全局幂等。

后台 Mini 只更新通知/失效标记。可见、有焦点的页面保留 HTTP 兜底（当前为 10 秒）；收到事件、重连或网络恢复可以提前刷新。没有变化时保留消息节点、阅读锚点、输入草稿和打开的工具。

已读只提交打开的单个会话 UID，且要求历史加载成功、窗口可见和获焦。已读请求途中来的新消息不能被旧请求抹掉：记录已加载消息的时间边界，同一毫秒还需核对服务端消息 ID。通知到达不等于用户已读。

通知气泡对话可直接复用历史与发送能力：根据事件建立有界本地通知收件箱，点击打开会话，收起保留草稿；历史与未读以官方 HTTP 响应为准。主进程保留事件队列后，UI 重建时不要重放很旧的 toast。

参考：[刷新调度](../../../src/client/private-refresh.ts)、[已读边界](../../../src/client/private-view-activity.ts)、[通知收件箱](../../../src/client/private-bubble-inbox.ts)、[跨页历史缺口](../../../src/client/private-history-gaps.ts)。这些是业务算法，不要求移植宿主 UI。

## 联系人在线查询

已实际读取并做双账号核实：EAPI `/api/communication/msg/setting/get`，参数 `{userId:peerUid,scene:1}`。

- 在线字段为 `data.online`。仅明确布尔 `true` 显示在线；`false` 是该次查询的离线结果；缺失/失败为未知，不能转成在线或确定离线。
- 资料在 `data.personalHomepage.userProfileData`，使用前确认返回 userId 对应请求 UID。
- `online` 与 `liveOnline` 不同，后者不是私信在线的替代字段。
- 静态另一读取接口 `/api/communication/dialogue/list` 使用 `dialogueQueryMeta`（含 time/limit 的 JSON 字符串）；在线字段在 `data.records[].userInfoVO.userInfoDetailList[].online`。本插件未用它替换会话列表。
- 私信列表可在线优先，同组再按最新消息排序。排序重排应保留节点和阅读锚点。

当前缓存参考：45 秒 TTL，两个并发查询，账号级隔离，失败退避 30 秒；针对实际加载的联系人查询，不仅处理第一页。数值是本地限流策略。

接口受互关、隐私和服务端传播延迟影响；无法据单次 false 断言双方不互关。双账号调查还核对了 `/api/user/setting`：旧 APK 的 `mutualFollowSeeOnline=0` 对应允许、2 对应关闭；这次未修改隐私，不能拿该枚举直接对当前账号写设置。

参考：[受控查询](../../../src/main/backend.ts)、[在线缓存](../../../src/client/private-presence.ts)、[联系人排序](../../../src/client/private-contacts.ts)。

## 在线推送和自身在线上报：尚未完成的部分

静态发现 `music_friend_throughtrain_notice`，旧 `ThroughTrainMsg` 以 `online` 或 `elementType=4` 表示在线用户，`elementType=1` 为直播用户。当前服务端通知结构已有差异，未完成真实在线通知/UI 接入，不能直接按旧类解析生产消息。

官方 Mini 生命周期会发 `service=3,command=2`：一字节 background（前台 0、后台 1），再 int32 零；登录后校正可见状态。当前独立实现只有登录和心跳，**没有发送这项前后台状态**。

未证明该请求对 `clientType=64` 的生产服务在线字段有何因果效果，也未证明只登录 Mini 就足够显示在线。之前双账号 `online=true` 时手机 App 仍在线，不能证明仅使用第三方桌面客户端即可在线。

`ichat/user/app/heartbeat` 属于另一业务，不用它替代网易云私信在线上报。验证方式见 [research-and-validation.md](research-and-validation.md)；不要把静态线索包装成已可用接口。
