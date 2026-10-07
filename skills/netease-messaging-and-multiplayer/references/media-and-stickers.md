# 图片、NOS 与自定义表情

协议实现入口：[MediaSender](../../../vendor/music-party/src/main/media-send.ts)、[媒体校验](../../../vendor/music-party/src/shared/media.ts)、[表情模型](../../../vendor/music-party/src/shared/stickers.ts)。普通图片、自定义表情与聊天图片发送是不同操作。

## 按消息内容判断可收藏来源

- 有有效非零 `emojiId` 和合法 `emojiGroupId`：官方表情，走 collect，不重新上传。
- `emojiId=0` 或没有官方表情身份，但有经过验证的真实聊天图片 URL 和尺寸：普通图片，下载后走自定义表情 upload。
- 自己或别人发送不改变这条判断。音乐封面、头像和没有图片来源的卡片不提供“添加到我的表情包”。
- 收藏判断不能仅看 message kind。房间的普通图片可能以 emoji 形式传送，ID 均为 0。

参考：[messageStickerSource](../../../src/shared/sticker-source.ts)。只在解析出的真实消息附件上开放操作，不能给页面上的每张 img 都加收藏。

## 图片类型：以字节为准

已用 PNG、JPEG、GIF、WebP 合成图片实测完整 NOS 上传并读音乐 CDN：四种均曾返回 `Content-Type: image/jpg`，NOS 存储类型正确。PNG/WebP 字节未变；JPEG/GIF 有内容处理但仍是原格式。结论只覆盖当时上传与 CDN 样本，不保证所有 CDN 路径始终如此。

因此不能只把 `image/jpg` 当 JPEG 修正别名，也不能从 URL 的 `.jpg` 推断真实格式。读取字节签名、核实可解码图片后归一化 MIME：

| 格式 | 识别重点                        | 上传 MIME / 表情保存 format |
| ---- | ------------------------------- | --------------------------- |
| PNG  | `89 50 4e 47 0d 0a 1a 0a`，IHDR | `image/png` / `png`         |
| JPEG | `ff d8 ff`                      | `image/jpeg` / `jpg`        |
| GIF  | `GIF87a` 或 `GIF89a`            | `image/gif` / `gif`         |
| WebP | `RIFF` + `WEBP`，VP8/VP8L/VP8X  | `image/webp` / `webp`       |

表情保存对 JPEG 使用 `jpg`；当前房间/私信图片消息的 format 则取 MIME 子类型，可能是 `jpeg`，不要把两处参数混成一条规则。

签名是格式识别，不是完整解码验证。参考下载器不转码原字节，使用识别后的 MIME、扩展名和已有合法尺寸；进一步处理以目标项目的解码器为准。

下载仅允许已核实的网易云资源 HTTPS 地址，不携带账号 Cookie。重定向逐跳重验白名单；检查 Content-Length 并限制流式读取总量。当前实现图片上限 20 MiB、尺寸上限 30000、下载时限 15 秒及最多三次重定向，属于本地保护参数。

参考：[downloadStickerImage](../../../src/main/sticker-image.ts)、[neteaseAssetUrl](../../../vendor/music-party/src/shared/media.ts)。

## 预览与目标绑定

Ctrl+V 或选择文件时先建立本地预览；确认发送前不申请 NOS token、不上传。预览绑定账号和原会话/房间，异步读文件、解码后再次检查目标；切换账号/会话/房间不得把旧预览发到新目标。关闭或替换预览时释放 object URL。

消息提交后超时可能已成功，使用 `deliveryUnknown` 告知并查历史；不要自动重新上传并再次发送。参考实现的 UUID 去重只存在当前进程和有限历史中。

Enter 换行、Ctrl+Enter 发送是参考产品的快捷键约定，不是网易云消息协议要求。

## NOS 图片上传链

1. 计算图片原字节 MD5。
2. EAPI `/api/nos/token/alloc`：`filename,type="other",bucket="yyimgs",nos_product=0,ext,local=false,md5,fileSize`。
3. 读取 `result` 的 `bucket/objectKey/token/docId`（也兼容 resourceId/key）；资源 ID 保持精度。当前只验证上传 channel 1，不猜测其他通道。
4. POST 到 `https://nosup-hz1.127.net/{bucket}/{encodedObjectKey}`，头为 `x-nos-token` 和识别后的 `Content-Type`。参数 `offset,complete,version=1.0`，后续分片带响应 `context`；核对确认 offset。本实现分片 2 MiB，上传不跟随重定向。
5. 优先用服务端 `outerUrl/downloadUrl`；当前图片后备为 `https://p1.music.126.net/{objectKey}`。随后再核实账号与发送目标。
6. 根据用户操作选择保存表情、发送房间图片或发送私信图片；仅完成 NOS 上传不等于消息发送或表情保存成功。

### 普通私信图片

EAPI `/api/communication/send/msg`，参数 `checkToken` 和 `sendMsgBody` JSON 字符串：

```js
const payload = {
  scene: 1,
  receiverUserIds: peerUid,
  channelId: peerUid,
  symphonyId: '',
  refMsgBody: {},
  msgBody: {
    msgType: 1,
    body: JSON.stringify({
      url: uploadedUrl,
      width,
      height,
      name,
      size,
      md5,
      format,
      emojiId: 0,
      emojiGroupId: '0',
    }),
    unikey: requestId,
    msgTime: timestamp,
    status: 1,
    sendStatus: 0,
    sender: { user: { userId: selfUid } },
    text: { textBody: '', atBody: [] },
  },
}
```

确认返回 `data.msgBody.msgId` 且 status 不是 -1/-2。实际服务端返回附件地址优先于客户端先前预测。发送已有表情仍用图片类型 1，但带真实 emojiId/groupId 和 URL，不再次 NOS 上传。

### 房间图片与表情

沿用 [multiplayer.md](multiplayer.md) 的 chatroom/send。`clientExt.emoji` 为：

```js
const emoji = { emojiId, emojiGroupId, emojiName, emojiImgUrl, width, height, format }
```

上传图片用 `emojiId="0",emojiGroupId="0"`；官方表情保留真实身份。外层 `msgType=0`，`msgBody.msg` 是名称占位，正文与图片不要重复渲染。

### 音视频与文件的证据边界

随仓库保留的独立实现还包含语音/视频 NOS：`/api/nos/token/whalealloc`，语音 `type=audio,bucket=ymusic,bizKey=519abfd2`，视频 `type=video,bucket=cloudmusic,bizKey=cb8c016e`。现代消息为 4/5；语音 duration 以秒提交，视频保持毫秒。它们没有移植到当前插件图片 UI，不能据此声称本插件支持音视频发送。

独立文件后备是 dmusic 上传后通过文字私信发送文件名和下载链接；虽能解析接收类型 49，完整原生 FILE=49 发送链仍未核实。其他项目接入前需按目标功能独立验证。

## 自定义表情接口

均为 EAPI：

| 操作         | URI                                    | 参数与确认                                                                                |
| ------------ | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| 分组         | `/api/social/emoji/groups`             | `resourceType=2` 私信、3 多人；`data.emojiGroups`，`edit=true` 为自定义组                 |
| 分页         | `/api/social/emoji/groups/detail/page` | `emojiGroupId,cursor,size=10`；`data.emojis`、`data.page.more/cursor`                     |
| 收藏已有表情 | `/api/social/emoji/collect`            | 真实 `emojiId,emojiGroupId`；`data.result=true`                                           |
| 上传保存     | `/api/social/emoji/upload`             | `imgs` 是数组 JSON 字符串，单项 `picId,width,height,format`；`data.emojiMap` 非空且可解析 |
| 删除         | `/api/social/emoji/cancel`             | `emojiIds` 是数字 token 数组的 JSON 字符串；`data.result=true`                            |

分组 ID 可能是负数字符串，不能把所有 ID 校验都改成正整数。没有显式 URL 时，官方 picId 地址算法在 [imageUrlForPicId](../../../vendor/music-party/src/main/stickers.ts)：picId 字符串字节与 `3go8&$8*3*3h0k(2)2` 循环 XOR，MD5、Base64，将 `/`→`_`、`+`→`-`，拼 `p1.music.126.net/{hash}/{picId}.jpg`；后缀仍不能证明真实格式。

表情/图片资源 ID 常超过 JS 安全整数范围。从原始 JSON 解析时保留 token；API 库若先丢失精度，客户端无法还原。删除数组也不能经 `Number(id)` 输出。空 emojiMap 或明确 false 表示未保存，展示官方 toast，不以 HTTP 200 冒充成功。

收藏/上传保存不调用私信或房间发送接口。

## 缓存与动态增删

参考缓存按账号/用途/分组划分，保留已加载页面、游标、more 和阅读位置；存储持久化能力需按项目实现确认，本插件参考策略主要是进程内缓存。

- 删除确认后只删除对应 ID，并发旧分页不能把它加回。
- 上传或收藏成功后合并新增内容，必要时刷新已加载前缀，保留后续分页与未变化节点；不要每次清空全部列表重新分页。
- 同一账号的多个表情视图订阅同一变更 revision；换账号清理缓存与“已添加”判断。
- 收藏去重可用 emoji ID 和 CDN origin+pathname，忽略尺寸查询参数；这仅是本地已知状态，不证明全库与服务端永久一致。

参考：[分页缓存](../../../src/client/sticker-view.ts)、[收藏 revision](../../../src/client/sticker-collection.ts)。
