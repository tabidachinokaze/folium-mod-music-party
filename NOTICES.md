# 来源与许可证

本插件由 tabidachinokaze 维护，采用 AGPL-3.0-only，完整许可证见 `LICENSE`。

`vendor/music-party/src/` 保存从 [Music Party](https://github.com/tabidachinokaze/music-party) 提取的多人协议、请求校验、消息解析、图片上传和同步逻辑。来源提交为 `91514369748ff803f2ee30385e4367dd71950740`；各文件的原始 SHA-256 记录于 `vendor/music-party/provenance.json`。这些文件随本仓库一同分发和维护，构建不依赖另一个本地仓库。

`host-patch/folia-0.7.10.patch` 面向 [Folia](https://github.com/chthollyphile/folia-major) 的 AGPL-3.0 代码生成；基线为 `76e1dfe`。本分支补丁包含 playback.sessions v2 原生队列与首页入口；对应宿主分支为 `feat/native-party-queue`。发行仓库为 [tabidachinokaze/folia-major](https://github.com/tabidachinokaze/folia-major)。Folia 原作者及贡献者的权利和署名保留。

`vendor/folium/contract.ts` 是宿主公开契约的类型快照，用于插件的编译期校验，来自 Folia 同名开发分支；来源提交和文件校验值见同目录 `provenance.json`。它沿用 Folia 的 AGPL-3.0 许可证，构建时仅使用类型，不执行该模块。
