# 证据、反编译与验证

此页支持继续研究和将协议移植到其他项目。资料整理日期 2026-10-07，不要求目标项目持有本机 APK 或历史账号。

## 证据分级

| 能力                                       | 已有证据                                                                      | 不能据此推断                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 多人分享与快照、加入/恢复、同步、推歌/切歌 | 官方页面/Android 字段；模拟测试；用户多次跨端实测反馈                         | 所有账号、版权和风控条件都可用                             |
| 创建与匹配                                 | 创建/匹配字段；实际匹配连接、通知、ACK 入房及退出验证                         | 任意 songId 都满足创建条件                                 |
| 私信正文推送                               | 8.8.40 静态链；真实账号 Mini 认证；两条连续真实通知通过正式解码与本地游标队列 | 登录成功就能保证收信；仅第一条测试足以证明连续去重正确     |
| 联系人在线                                 | 原生 setting/get 查询；双账号缓存绕过后确认互关、在线                         | 任一 false 证明不互关；目标只用第三方桌面客户端也会在线    |
| 在线通知                                   | 旧 APK throughtrain 业务与枚举                                                | 当前生产 payload 一定相同；在线推送已经接入                |
| 自身在线上报                               | Mini 前后台包的静态布局                                                       | clientType 64 的因果效果；已经实现或完成实测               |
| 图片收藏/CDN 类型                          | 当前房间只读结构核实；PNG/JPEG/GIF/WebP 完整 NOS 上传和 CDN 内容实测          | 全部 CDN 路径都返回相同 MIME；收藏实测代表私信或房间已发送 |
| 图片表情、已读、气泡对话与缓存             | 固定参数与当前实现；模拟逻辑/浏览器回归                                       | 所有分支已经对真实账号写入验证                             |

原始历史文档包含早期版本的“尚未接入推送”记录。那是当时的范围，不能覆盖随后 0.3.21 的私信推送实现；房间消息仍轮询是另一件事。

## 保留的官方静态资料

多人分享网页配置的体验包：

```text
来源 URI：/api/middle/clientcfg/config/pushed/list
moduleName=listen_together, app=music, platform=web,
keys=[multilisten_app_beta_url]

APK：https://nos.netease.com/music-static/91805039-f569-4445-bc67-ee1306f9c998.apk
versionName：8.8.40
versionCode：8008040
SHA-256：f86580bd4e830d8bafe0ca586d5c12d484f0f3adbb1cd0988a4c099e3f3e565d
```

该包曾只作静态分析，没有安装运行；它不是用户当前生产 App 版本的保证。继续下载研究材料时重新核对版本与哈希，存于忽略目录，不提交或打包 APK/DEX/反编译源码。

RN 队列通过 `/api/rncache/resinfo/get`，`moduleName=rn-tt-playlist,sdkVersion=0.60` 取得过元数据：version `1677825891305`、fullMd5 `bd3635b6b23e79815ea33822af2ccff1`。房间类型来自另一个 `rn-tt-search` bundle；不能把队列包的版本/哈希套给搜索包。

### 继续定位的类、方法和关键词

| 目标               | 静态入口                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| 多人请求参数       | `classes9.dex`，`com.netease.cloudmusic.module.listentogether.api.a1.l` 及调用方                       |
| 心跳与进度单位     | `classes10.dex`，`module.n0.y`                                                                         |
| 创建 type          | `listentogether.invite.dialog.j`，allowStrangerMatch→2/1                                               |
| 房间 JSON 别名     | `LTMultiRoomInfo` 的 `multiRoomInfoDTO/multiLtRoomUserAgg` 注解；`LTMultiMatchRoomMsgInfo`、`RoomInfo` |
| 原生邀请包装       | `CommonMessage.fromJson`、`module.s0.a`、`ResCardMsg`，搜索 nativeUrl/url1/url2                        |
| 已读               | `classes8.dex`，`messagecenter.api.c.a(Long)`、`MessageCenterDetailFragment`                           |
| 私信正文通知注册   | `MainActivity.B8`、`im.b.e("private")`、`ACTION_FETCH_CHAT_OBSERVER`                                   |
| 私信解码           | `ChatIMManager.onMessageReceived`、`music.biz.chat.k.i`、RawMessage                                    |
| 在线查询           | `messagecenter.detail.d`，communication/msg/setting/get                                                |
| 在线列表与头像     | `messagecenter.privatemsg.c`、`MessageCenterPrivateViewHolder`、UserInfoDetail.online                  |
| 在线通知           | `discovery.utils.h`、ThroughTrainMsg、`THROUTH_TRAIN_FRIEND_ONLINE_NOTICE`（原拼写）                   |
| 在线隐私           | `MessagePrivacyApi`、`NotifySettingActivity`、mutualFollowSeeOnline                                    |
| Mini 登录/生命周期 | `nimmini.c`、MiniNIMClient、MiniCoreManager、ActivityLifecycleCallbacks、MiniForegroundRequest         |
| 现代消息与上传     | `messagecenter.detail.d`、RawMessage、PicMsg、PostImageHelper、PostVoiceHelper、PostVideoHelper        |
| 自定义表情         | `BigExpressionFragment`、`module.bigexpression.d`、EmojiSubInfo、ImageUrlUtils                         |

混淆类名随版本变动。先搜端点/业务字符串，再沿调用者追参数和结果；接口字符串存在并不证明当前业务路径在使用它。优先保存自写字段说明与引用位置，不复制大段反编译实现。

本机历史材料在旁侧 `music-party/.local/research/`，私信研究摘要集中于 `private-push-audit/`；这些不随本仓库分发。`findings.json`、`online-status-findings.json`、`online-two-account-validation.json` 与 `presence-publishing-findings.json` 的有效结论已在本技能展开，目标项目无需这些文件。

## 先做离线验证

移植后写目标项目自己的协议测试，而不是依赖此仓库 UI。最有价值的用例：

- 正 ID 重投只处理一次，两个 ID 0 的不同通知都接收，坏业务包不影响别的业务回执。
- 账号切换后旧 token 请求、旧通知和旧图片上传结果均作废；取消匹配保留独立的私信订阅。
- 解压超限、消息 ID 精度丢失、错误 targetUserList、sender 元数据不匹配时正确拒绝或降级。
- 房间 JSON wire 名、时间单位、同曲不同 bizId、完整分页、当前条目权限与业务失败码。
- 接收消息不会自动已读；已读请求中途的新消息、同毫秒不同 ID 不被清除。
- 图片四种签名、错误/缺失 MIME、受限重定向、收藏与发送分离、删除后旧分页不能复活条目。

本仓库可直接定位的测试入口：

```bash
npm test -- tests/mini-codec.test.ts tests/mini-notifications.test.ts tests/shared-notifications.test.ts tests/private-notice.test.ts
npm test -- tests/private-presence.test.ts tests/private-contacts.test.ts tests/private-refresh.test.ts tests/private-bubble-inbox.test.ts
npm test -- tests/backend.test.ts tests/matching.test.ts tests/room-recovery.test.ts tests/red-heart.test.ts
npm test -- tests/sticker-image.test.ts tests/message-sticker-source.test.ts tests/sticker-collection.test.ts
```

这些测试使用模拟传输，不等于跨端实测。只有实现或行为变更才跑相关逻辑/浏览器检查；仅修订资料时验证技能元数据、引用路径与格式即可，不必构建安装包。

## 真账号验证的范围与记录

获得当前任务授权后，使用受控两个测试账号，以匿名 A/B 标识记录结果。二维码登录不是互发消息授权，授权两条也不扩展为任意后续消息。接收验证必须走准备交付的传输、业务解析和事件队列，不能只用另一个诊断脚本收到包就称产品链成功。

每次账号/状态请求绕过已知封装缓存，并内部核对请求账号。日志只保留匿名角色、端点、code、字段类型、序列/计数、耗时和明确结论；不写 Cookie、IM token、二维码 key、完整私信正文、头像 URL 或账号 ID。

连续通知测试至少覆盖不同正文的连续消息、重投去重、双向收发、关闭私信页面后的后台接收及断线重连。服务器业务正文不打印，仅记录是否解析、是否匹配目标及是否到达目标业务层。

### 自身在线上报的专门对照

尚待完成因果实测。需在获准的账号 A 上完全退出手机和其他官方客户端，账号 B 只查询 A，不误把观察账号当目标账号。

依次记录离线基线、仅 Mini 登录+心跳、真实前台状态包、真实后台状态包、断开后的状态，并给服务端传播留时间。每次查询绕过缓存、检查可见在线隐私但不自动修改它。协议 ACK 只能证明包被接受，最终以独立 B 的 `data.online` 变化判断，不能沿用之前手机同时在线时的结果。

## 常见故障的定位顺序

| 现象                     | 优先检查                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| 匹配成功提示却没进房     | 音乐 Mini 通道是否正确；WAIT_ACK 通知是否过滤；ACK 是否返回对应房间 |
| 只收到第一条私信         | 包装 ID 0/负数误去重；业务 ID 与游标是否更新                        |
| 私信页一直刷新但无新消息 | local queue 读取与 HTTP 兜底分别计数；没有变化时是否保持节点        |
| 查询全离线/误判不互关    | 请求实际账号、URL 缓存绕过、data.online 类型、互关与隐私证据        |
| 图片收藏提示不支持格式   | CDN MIME 与字节签名分别检查；不要先认定剪贴板或上传转成 JPEG        |
| “升级 App”与图片同时展示 | 是否解析了现代 body/emoji；兼容占位是否重复渲染                     |
| 已在房间但恢复入口不见   | 操作失败后重新查 status；账号实际 roomId 与本地缓存是否一致         |
| 删除表情后全部重新加载   | 是否只移除确认 ID；分页游标、滚动锚点和旧请求 revision 是否保留     |

维护本技能时，用新的可复核证据更新对应能力条目与日期；不要把某个失败样本变成“该能力永远不存在”的规则。
