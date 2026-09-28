# folium-mod-music-party

Music Party for Folia · [插件仓库](https://github.com/tabidachinokaze/folium-mod-music-party) · [适配版 Folia](https://github.com/tabidachinokaze/folia-major)

与网易云官方 **多人一起听** 房间互通的 Folium 插件。好友继续使用网易云官方手机 App；Folia 负责音乐播放、歌词和视觉效果。

## 兼容性：请先看这里

当前版本为 **0.1.0**，适配 **Folia 0.7.9 + externalPlayback v1**。推荐使用 [tabidachinokaze/folia-major](https://github.com/tabidachinokaze/folia-major)，该 fork 已集成播放适配接口。上游原版 Folia 0.7.9 只安装插件 ZIP 无法开始一起听。

插件清单限定精确版本；升级 Folia 时，需要重新验证兼容性。

## 安装

1. 安装包含 `externalPlayback v1` 的 [Folia fork](https://github.com/tabidachinokaze/folia-major/releases)。若还没有对应安装包，可以从 fork 源码运行：

   ```bash
   git clone git@github.com:tabidachinokaze/folia-major.git
   cd folia-major
   npm ci
   npm run dev:electron
   ```

2. 从本项目 [Releases](https://github.com/tabidachinokaze/folium-mod-music-party/releases) 下载插件 ZIP，或独立构建：

   ```bash
   git clone git@github.com:tabidachinokaze/folium-mod-music-party.git
   cd folium-mod-music-party
   npm ci
   npm run build
   ```

3. 在 Folia 的「设置 → 实验室」开启模组系统，将 `dist/folium-mod-music-party-0.1.0.zip` 拖入模组面板，启用 **Music Party**。在 Folia 登录网易云后，通过播放栏的双人图标，或命令面板的「打开网易云多人一起听」打开插件。
4. 点击「连接网易云账号」，然后选择「恢复当前房间」、粘贴官方多人邀请链接，或先播放一首网易云歌曲再创建房间。

运行时直接使用 Folia 自带的本地网易云 API，不需要 Docker，也不需要另开 Music Party 客户端。插件不会另存 Cookie；账号切换后需要重新连接。构建所需的协议代码已随仓库提供，不依赖旁边的 Music Party 源码目录。

如果选择手动适配上游原版 0.7.9，可对基线 `481805873a0b04ca6277dd21c0968ab1e1c4ab02` 执行 `node scripts/apply-host-patch.mjs /path/to/folia-major`，然后重新构建桌面版。**本 fork 已包含补丁，不要重复应用**；脚本不能直接修改已安装应用的 ASAR。

## 已实现

- 官方多人房间创建、链接加入、恢复、退出，成员与同步状态。
- 房间歌曲经 Omni 查询并进入 Folia 的正常音频和歌词管线；按服务器时间对齐进度。
- 点选网易云歌曲转为推歌，搜索推荐、完整分页待播队列、删除自己的推荐、置顶、房间点赞。
- 原播放栏「下一首」发起官方切歌请求。自然结束只查询服务端下一条歌曲，不发送切歌操作。
- 本机暂停跨远端切歌保持暂停，恢复时重新对齐；一起听期间暂停本地循环和混音，退出/禁用后恢复个人队列及原有循环、混音设置。
- 房间文字聊天、图片/音视频等历史消息展示、官方自定义表情读取与发送。
- 私信会话与分页历史、文字发送、表情发送、官方邀请卡片解析与加入、向所选会话发送一起听邀请。私信只在会话可见且窗口获焦时标为已读。
- 播放栏入口、命令入口、独立房间面板、过渡动画、减少动态效果偏好、点击表情浮层外关闭。

用户在界面点击发送/邀请时才发送消息。停用插件只停止本地同步、释放播放控制，不自动退出服务端房间；需要退出时点击「退出房间」。退出后个人队列恢复但不会自动开始播放。

## 当前边界

- 仅桌面 Folium 主窗口；不支持 Web/PWA、Stage 播放或混音过渡中途接管。当前官方 API 的版权、会员和风控限制仍然适用。
- 同步及收信使用心跳/状态/历史查询；已加入歌曲结束附近的快速状态重查，尚未接入官方云信 IM 实时推送。
- 自定义表情可读取和发送；图片/文件上传、录音和视频发送尚未移植到插件版。Music Party 独立客户端中的这些功能继续保留。
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

`host-patch/folia-0.7.9.patch` 增加版本化的播放租约接口，并在现有选歌、下一首、上一首、进度调整处区分用户意图和服务端播放。租约释放及切换时失效的异步请求不能重新启动歌曲；未启用插件时保持原有路径。

自动化验证使用本地模拟网易云服务，不发送真实私信或房间消息。真实账号跨端联调需使用安装后的适配版 Folia 验收，不能用模拟测试替代。

本插件采用 AGPL-3.0；宿主 Folia 的许可证见其仓库 LICENSE。

## 发布与更新

Folia 本体从 [fork 的 GitHub Releases](https://github.com/tabidachinokaze/folia-major/releases) 更新。首次需要安装 fork 构建的应用，后续发布更高版本的正式 Release 和完整更新元数据后，应用内即可检查更新。详细通道说明见 [宿主文档](https://github.com/tabidachinokaze/folia-major/blob/main/docs/desktop/music-party-fork.md)。

本插件推送代码后由 GitHub Actions 检查并上传构建 artifact。准备发布时同步更新 `package.json`、`mod.json`、`RELEASE.md`，再推送对应 `v*` 标签，工作流会发布 ZIP 和 SHA-256 校验值到本仓库 Releases。插件更新仍通过安装新的 ZIP 完成；模组 ID 保持 `music-party`，保留与既有安装的身份一致性。
