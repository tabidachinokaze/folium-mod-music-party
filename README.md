# folium-mod-music-party

Music Party for Folia · [插件仓库](https://github.com/tabidachinokaze/folium-mod-music-party) · [适配版 Folia](https://github.com/tabidachinokaze/folia-major)

与网易云官方 **多人一起听** 房间互通的 Folium 插件。好友继续使用网易云官方手机 App；Folia 负责音乐播放、歌词和视觉效果。

## 兼容性：请先看这里

**正式配套：Folia 0.7.12 + 插件 0.3.1。** 请先升级宿主，再安装并重新启用插件。新版使用播放会话接口 v2。

| 宿主                                      | 插件  | 状态                   |
| ----------------------------------------- | ----- | ---------------------- |
| Folia 0.7.12                              | 0.3.1 | 推荐配套，全新私信界面 |
| Folia 0.7.11                              | 0.3.0 | 推荐配套，接口 v2      |
| 已发布 Folia 0.7.10 安装包                | 0.2.0 | 既有配套，接口 v1      |
| 已发布 Folia 0.7.10 安装包                | 0.3.0 | 不兼容，需升级宿主     |
| Folia 0.7.10 源码应用本仓库 v2 补丁后重建 | 0.3.0 | 仅开发兼容             |
| 已发布 Folia 0.7.9                        | 0.1.0 | 旧接口配套             |

manifest 声明 `experimental: ["playback.sessions"]` 与 `playback.control`，本版版本范围为已验证的 0.7.12。范围内仍需提供接口 v2；插件会检查接口版本并显示升级提示。插件更新使用相同 ID，安装新版 ZIP 后需要重新启用。

## 安装

1. 安装 [Folia 0.7.12](https://github.com/tabidachinokaze/folia-major/releases/tag/v0.7.12)。也可从主分支源码运行：

   ```bash
   git clone git@github.com:tabidachinokaze/folia-major.git
   cd folia-major
   npm ci
   npm run dev:electron
   ```

2. 下载 [插件 0.3.1 ZIP](https://github.com/tabidachinokaze/folium-mod-music-party/releases/tag/v0.3.1)。也可从主分支构建：

   ```bash
   git clone git@github.com:tabidachinokaze/folium-mod-music-party.git
   cd folium-mod-music-party
   npm ci
   npm run build
   ```

3. 在 Folia 的「设置 → 实验室」开启模组系统，将 `folium-mod-music-party-0.3.1.zip` 拖入模组面板并启用。在 Folia 登录网易云后，点击播放栏的一起听图标或执行「打开网易云多人一起听」。
4. 连接账号，再恢复房间、粘贴官方邀请链接，或播放网易云歌曲后创建房间。私信可以直接从首页顶部胶囊进入，无需先加入房间。

Folia 0.7.11 已包含宿主接口，无需打补丁。若从本 fork 的 0.7.10 源码（基线 `76e1dfe`）适配，可执行 `node scripts/apply-host-patch.mjs /path/to/folia-major`，再重新构建桌面版。补丁不能修改已安装应用的 ASAR，也不适用于上游原版 0.7.9。

运行时使用 Folia 自带的本地网易云 API，不需要 Docker 或独立 Music Party 客户端。插件不会另存 Cookie；账号切换后需要重新连接。协议代码随仓库提供，构建不依赖旁边的源码目录。

## 0.3.1：私信界面优化

私信采用固定高度双栏布局：会话显示头像、用户名和最新消息预览；列表底部自动加载会话，消息上方滚动加载历史并保留阅读位置。私信反馈与房间状态隔离，图片等附件不再重复显示占位文字。

输入区提供 Emoji、颜文字、表情包和图片浮层。支持私信图片上传，以及网易云自定义表情上传、整理、多选删除；删除以官方 `data.result` 确认为准。表情收藏不会发送给好友。测试仅使用模拟接口，没有发送真实私信。

完整的无外层滚动布局需同时升级 Folia 0.7.12；此版本已包含首页容器高度修复。

## 已实现

- 官方多人房间创建、链接加入、恢复、退出，成员与同步状态。
- 房间歌曲经 Omni 查询并进入 Folia 的正常音频和歌词管线；按服务器时间对齐进度。
- 点选网易云歌曲转为推歌。房间完整队列接管原生播放列表、命令面板搜索和队列拼贴；移除插件内重复的待播页。
- 房间队列以同步按钮替代打乱，隐藏下一首播放/移到队尾。待播条目支持置顶、删除自己的推荐；只有当前播放条目显示点赞，可连续多次点赞。重复歌曲按官方推荐条目 ID 区分。
- 原播放栏、拼贴、「下一首」命令和 Ctrl/Cmd+右方向键均发起官方切歌请求。自然结束只查询服务端下一条歌曲，不发送切歌操作。
- 本机暂停跨远端切歌保持暂停，恢复时重新对齐；一起听期间暂停本地循环和混音，退出/禁用后恢复个人队列及原有循环、混音设置。
- 房间文字聊天、图片/音视频等历史消息展示、官方自定义表情读取与发送。
- 首页顶部胶囊提供私信入口；会话与分页历史、文字发送、表情发送、官方邀请卡片解析与加入、向所选会话发送一起听邀请。私信只在会话可见且窗口获焦时标为已读。
- 播放栏入口、命令入口、独立房间面板、过渡动画、减少动态效果偏好、点击表情浮层外关闭。

用户在界面点击发送/邀请时才发送消息。停用插件只停止本地同步、释放播放控制，不自动退出服务端房间；需要退出时点击「退出房间」。退出后个人队列恢复但不会自动开始播放。

## 当前边界

- 仅桌面 Folium 主窗口；不支持 Web/PWA，也不在私人 FM、Stage、视频录制或混音过渡期间接管。当前官方 API 的版权、会员和风控限制仍然适用。
- 同步及收信使用心跳/状态/历史查询；已加入歌曲结束附近的快速状态重查，尚未接入官方云信 IM 实时推送。
- 私信图片发送、自定义表情读取/发送/上传/删除已实现。房间图片上传、私信文件上传、录音和视频发送尚未移植到插件版；独立客户端中的这些功能继续保留。
- 本版不覆盖所有 Folia 外部播放模式；使用一起听时请通过正常网易云歌曲入口选歌。插件没有自定义完整音源 provider。
- 插件更新使用相同 ID 的新 ZIP 安装；由于 Folium 的信任确认绑定文件内容，更新后需要重新启用。尚无插件自身的自动更新器。

## 开发与验证

在本仓库根目录执行（Node.js 24+）：

```bash
npm ci
npm run check
npm run test:ui
```

首次运行浏览器测试需要 `npx playwright install chromium`。若已有适配后的 Folia Vite 开发服务器，可运行 `FOLIA_URL=http://127.0.0.1:4175 npm run test:ui`，额外验证实际 Folium 注册、音频/歌词加载、原生下一首和循环设置恢复。

`build` 将 `vendor/music-party/src` 中的多人协议、校验、队列和消息解析一起打进插件，产物不依赖源码目录。来源提交及文件指纹见 `vendor/music-party/provenance.json` 和 [NOTICES.md](NOTICES.md)。`src/main` 只允许固定房间/消息操作；普通歌曲搜索与播放走宿主 Omni。`src/client/host.ts` 集中封装 Folia 账号与内部接口适配。

`host-patch/folia-0.7.10.patch` 将 experimental playback.sessions 升级到 v2，增加原生队列投影、条目操作、同步和独立下一首可用状态，并提供通用首页模组入口。租约释放及切换时失效的异步请求不能重新启动歌曲；未启用插件时保持原有路径。

自动化验证使用本地模拟网易云服务，不发送真实私信或房间消息。真实账号跨端联调需使用安装后的适配版 Folia 验收，不能用模拟测试替代。

本插件采用 AGPL-3.0；宿主 Folia 的许可证见其仓库 LICENSE。

## 发布与更新

Folia 本体从 [fork 的 GitHub Releases](https://github.com/tabidachinokaze/folia-major/releases) 更新。首次需要安装 fork 构建的应用，后续发布更高版本的正式 Release 和完整更新元数据后，应用内即可检查更新。详细通道说明见 [宿主文档](https://github.com/tabidachinokaze/folia-major/blob/main/docs/desktop/music-party-fork.md)。

本插件推送代码后由 GitHub Actions 检查并上传构建 artifact。准备发布时同步更新 `package.json`、`mod.json`、`RELEASE.md`，再推送对应 `v*` 标签，工作流会发布 ZIP 和 SHA-256 校验值到本仓库 Releases。插件更新仍通过安装新的 ZIP 完成；模组 ID 保持 `music-party`，保留与既有安装的身份一致性。

## 播放接口迁移

- 获取会话改为 `acquire({ onIntent, restore: 'queue-stopped' })`；播放、批量入队、自然结束、播放错误和 seek 使用不同的事件类型。
- `play()` 明确返回音源提交、取消、被替代、不可用或失败；插件只在音源提交并取得 metadata 后对齐进度并播放，取消不再进入 20 秒等待。
- 会话由宿主管理清理，插件也会主动释放。私人 FM、Stage、视频录制和混音过渡中不获取会话，给出可操作的提示；退出后恢复原队列并停止播放。
- 聊天/私信/房间协议继续留在插件。网易云来源校验也留在插件；宿主接口支持其他 Omni provider。

- v2 新增 `session.setQueue` 与 `session.stop`；队列展示与音频缓存身份分离，点赞/心跳不会重建拼贴。`queue-action` 的权限和官方协议仍由插件处理。
- 私信使用 `registries.homeTabs` / `ui.openHomeTab`；原生队列使用 `ui.openQueue`。停用插件会自动清除首页入口和房间队列。
