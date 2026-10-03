# 来源与许可证

本插件由 tabidachinokaze 维护，采用 AGPL-3.0-only，完整许可证见 `LICENSE`。

`vendor/music-party/src/` 保存从 [Music Party](https://github.com/tabidachinokaze/music-party) 提取的多人协议、请求校验、消息解析、图片上传和同步逻辑。来源提交为 `91514369748ff803f2ee30385e4367dd71950740`；各文件的原始 SHA-256 记录于 `vendor/music-party/provenance.json`。这些文件随本仓库一同分发和维护，构建不依赖另一个本地仓库。`files` 保留提取时的原始指纹；`localFileHashes` 记录插件维护后的文件指纹，其中包含已播记录查询、消息/表情适配及 0.3.4 的多人匹配、取消、重新匹配和创建参数校验，以及 0.3.10 的歌曲/专辑分享元数据解析修正和 0.3.11 的活动卡片、资源链接解析及原生跳转适配，以及 0.3.13 的接收表情元数据和收藏请求适配，及 0.3.14 按官方客户端核实的表情收藏协议修正，以及 0.3.16 的官方房间红心操作适配。

`host-patch/folia-0.7.10.patch` 面向 [Folia](https://github.com/chthollyphile/folia-major) 的 AGPL-3.0 代码生成；基线为 `76e1dfe`。本分支补丁包含 playback.sessions v2 原生队列与首页入口；对应宿主分支为 `feat/native-party-queue`。发行仓库为 [tabidachinokaze/folia-major](https://github.com/tabidachinokaze/folia-major)。Folia 原作者及贡献者的权利和署名保留。

`vendor/folium/contract.ts` 是宿主公开契约的类型快照，用于插件的编译期校验，来自 Folia 同名开发分支；来源提交和文件校验值见同目录 `provenance.json`。它沿用 Folia 的 AGPL-3.0 许可证，构建时仅使用类型，不执行该模块。

多人匹配通知由 `src/main/mini-codec.ts` 和 `src/main/mini-notifications.ts` 实现音乐专用 mini 通道的协议兼容。官方 Android 资料用于核对公开应用标识、公开服务器公钥、帧格式和字段，未打包反编译代码。使用 Node.js 自带的网络、加密和压缩模块；RC4 仅用于兼容该服务的既有流协议。0.3.6 起不再分发 `nim-web-sdk-ng`。

0.3.17 的房间公开状态使用服务端 `roomBizType`：官方 RN 房间类型枚举为 `PrivateFriend = 1`、`PublicFriend = 2`、`Public = 3`，Android bridge 的 `getRoomType` 返回该字段。仅据已核实的类型判断陌生人匹配状态，其他值保留为未知。官方资料仅用于协议字段核对，未随插件分发。

## Danmaku

弹幕绘制使用 [weizhenye/Danmaku](https://github.com/weizhenye/Danmaku) 2.0.10 的独立 DOM 引擎（npm 包 `danmaku`），按 MIT 许可证随客户端 bundle 分发。该项目是社区浏览器引擎，不是哔哩哔哩官方网页播放器源码；本插件未包含 B 站私有代码。每条消息使用独立时钟，暂停不影响音乐播放。

```text
The MIT License (MIT)

Copyright (c) 2014 Zhenye Wei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
