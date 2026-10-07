# 请求传输与官方 Mini 通知

本页描述已实现和已实测的传输方式。超时、队列容量和重试间隔是本实现的选择，除明确注明外，不是网易云协议要求。

## HTTP 调用的两层路径

`/msg/private/history`、`/send/text`、`/register/checktoken/v3` 是 NCM API 服务的封装路由；`/api/communication/send/msg` 等是网易云原生 URI。不要把封装服务路径当作网易云官方路径。

当前多人、在线查询和媒体接口通过封装服务的 `/api` 通用入口调用：

```js
// invoke 是目标项目的受控传输适配器；此例不是直接向 music.163.com 发明文 JSON。
await invoke('api', {
  uri: '/api/communication/msg/setting/get',
  crypto: 'eapi',
  data: { userId: peerUid, scene: 1 },
  cookie: accountCookie,
})
```

由经过验证的请求库生成加密、设备头及 Cookie。旧会话/历史封装使用 WEAPI；其他封装的默认方式以所用库实现为准，不能统一改成 EAPI。

### 登录与请求校验

- 二维码封装依次为 `login_qr_key`、`login_qr_create`、`login_qr_check`；检查码 800/801/802/803 分别表示过期/待扫码/待确认/成功。成功仍需确认有效 Cookie；二维码生成不是独立的官方网络端点。
- 原生二维码 key/check URI 为 `/api/login/qrcode/unikey` 与 `/api/login/qrcode/client/login`，参数含 `type=3`。
- 使用 `login_status` 确认实际 UID。隔离账号的 Cookie，不能依赖共享 Cookie jar 恰好处于正确账号。
- `register_checktoken_v3` 是校验 token 的封装入口。当前多人创建/加入/匹配及歌曲操作、现代私信图片发送使用新鲜 token；缺失时明确失败，不绕过校验。
- 自己的 Cookie、Mini `accId/token` 与请求 `checkToken` 用途不同，不能互换。

### 本地 API 缓存：已经实测踩过的坑

所用 NCM API 的 `apicache` 可以按 URL 缓存而忽略 POST body。同一个 `/api` 或 `/login/status` URL 配合不同账号、不同 URI 时，曾复用旧响应，导致错误判断两个账号不互关、全部离线。这些旧结论已撤回。

在此类封装服务中，账号/状态/写操作使用：

- 请求 URL 的唯一随机 `timestamp`，不是只改 body 内的时间戳。
- `x-apicache-bypass: true`。
- body 内显式指定本次账号 `cookie`，并设 `noCookie: true`，避免依赖服务端默认 Cookie。

这些措施针对已观察到的封装缓存行为。其他项目直接实现官方传输时，应核对自己的缓存和账号隔离机制。

实现入口：[createHttpInvoker](../../../vendor/music-party/src/main/transport.ts)、[精确 JSON 解析](../../../vendor/music-party/src/main/precise-json.ts)。

## Mini 获取凭据和选择通道

原生 EAPI：`/api/middle/im/token/get`，`data={bizTag:"platform"}`；要求 `code=200` 且 `data.accId`、`data.token` 是非空字符串。凭据仅留在受控网络进程内存。

已实测通道：

| 项目               | 值                                 |
| ------------------ | ---------------------------------- |
| TCP 服务           | `link-music-main.netease.im:8080`  |
| 音乐生产应用标识   | `688ebe2a6a7da3d1125936d9ee8b0966` |
| 服务产品           | `6`（music mini）                  |
| 当前桌面客户端类型 | `64`                               |

应用标识及客户端公钥是协议公开常量，账户 token 不是。通用 Web IM SDK 曾能认证但收不到多人匹配业务，不能把“SDK 已登录”当作选对了业务通道。

### 握手与帧

参考 [mini-codec.ts](../../../src/main/mini-codec.ts) 与 [mini-notifications.ts](../../../src/main/mini-notifications.ts) 核对完整编解码，不直接导入反编译 SDK。

1. 随机生成 16 字节会话密钥。双方流方向分别保持 RC4 状态，这是当前旧协议的兼容方式。
2. 首帧 `service=1, command=5` 发送公开版本 0 的 RSA/PKCS#1 握手；当前实现以 117 字节分块加密密钥属性和登录帧。
3. 收到握手成功后发送加密登录帧 `service=2, command=2`。登录属性包括：`3=64`、`6=6`、`8=0`、`9=1`、`18=appKey`、`19=accId.toLowerCase()`、`25=客户端标识`、`26=UUID`、`1000=token`。
4. 登录成功后发送 `service=1, command=2` 心跳；`service=2, command=5` 表示会话被关闭，不能继续假装连接有效。

帧为 varint 长度前缀 + 5 字节头 + body。头是 service、command、uint16LE serial、flags；flags 的 bit 1 表示附加 uint16LE status，bit 0 表示压缩 body（uint32LE 解压后长度 + zlib 数据）。属性表包含 varint 字段数，以及每项的数字键、长度、UTF-8 值。实现支持 TCP 分片与多帧拼接，帧和解压输出上限 1 MiB。

这里的 zlib 帧压缩与私信 `serverExt.data` 中的 GZIP 业务包是两层，不能只解压一次或互换算法。

### 包装回执与去重

- 包装帧位于 `service=4`，命令 1/2/10/11；内部业务通知为 `service=7, command=3`。
- 包装头先读 8 字节有符号 int64LE delivery ID，再解析内部包。命令 2 的回执 serial 规则与其他命令不同，参考 `embedded`。
- 仅对**正 delivery ID** 去重；内部通知需要的回执为 `service=4, command=3`，携带原 ID 和内部头。
- 0 和负数不是唯一 delivery ID，不能以它们去重。两条真实私信曾连续使用 ID 0，旧实现只收到第一条；修复后连续接收均已实测通过。
- 去重还需业务消息 ID 层：同一 delivery ID 的重投与不同消息共享 0 包装 ID 是不同情况。
- 通知属性 0 是时间戳，属性 5 是业务 content。坏业务包的解析失败不能中断其他订阅者或阻止回执。

## 连接共享与本地事件队列

当前实现由一个账号范围的 Mini 登录同时服务匹配和后台私信。取消匹配只移除匹配订阅；仍需后台私信时保留连接。账号切换、退出账号和整体停用则关闭连接并清空旧事件。

[SharedNotifications](../../../src/main/shared-notifications.ts) 的当前策略：心跳 10 秒、持久会话接收静默 45 秒判失联；重连从 1 秒逐步退避至 60 秒；保存最多 256 个私信事件，以 session UUID + sequence 游标读取。重连成功产生 `sync`，事件丢失/主进程替换也触发 HTTP 快照补偿。

前端每秒读取本地队列的策略见 [PrivateNotifications](../../../src/client/private-notifications.ts)。这不等于每秒向网易云请求私信。后台接收不依赖打开会话或加入一起听房间，也不提交已读。
