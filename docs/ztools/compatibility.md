# 当前移植与验证状态

更新：2026-11-09。此表记录实施中的实际结果，不是最终版本功能承诺。

| 模块 | 当前结果 | 证据 |
|---|---|---|
| P0 生产入口、生命周期、存储能力 | PASS，特定宿主/运行时组合 | `npm run test:p0`；artifacts/p0/report.json |
| 原 LX 数据模型 | 已迁入原列表/下载记录/不喜欢/歌词/URL/换源数据模块 | 设备本地 SQLite；列表及事务回滚已验证，其他数据契约继续补测 |
| 原界面构建 | PASS，独立 Webpack web target | `node scripts/build-lx.mjs` |
| 搜索页、基本设置页 | PASS，真实宿主导航及可见区域截图 | `node scripts/test-lx-renderer.mjs`；artifacts/renderer/settings.png |
| 自定义音源 API 2.0.0 | 已实现隔离执行、初始化、HTTP 回调、同步 crypto/Buffer/zlib、能力与结果校验 | P0 与 source 集成验证 |
| 导入及使用测试音源 | PASS，导入原始脚本→启用→解析播放 URL；未知音质拒绝；切源取消旧请求 | `node scripts/test-source.mjs`；只使用本地可控脚本/HTTP 服务 |
| 原界面本地文件/URL 导入操作 | PASS，两种入口均已通过 | `node scripts/test-source-ui.mjs`；文件选择器返回受控路径，其余为实际 UI、宿主 API 与文件服务 |
| 用户真实音源/真实平台搜索 | 未提供真实音源，未全量验证外部服务 | 不预置第三方源，不以本地 fixture 结果代替 |
| 音频解码、实际播放与后台播放 | PASS，原 LX 引擎播放受控 WAV，进度、暂停/继续、后台及下一首 | `node scripts/test-player.mjs`；不替代真实平台及人工听音验收 |
| 排行榜、在线歌单、备份 | 原模块已随上游源码迁入，业务适配/回归待完成 | 不算支持完成 |
| 下载与续传/标签 | 待完成执行器移植 | 下载记录 SQL 模块可用不等于下载已可用 |
| LX 同步、开放 API、桌面歌词、快捷键 | 待实现和独立验证 | 不算支持完成 |
| 可安装开发包 | PASS，ZIP 安装后搜索 lxmusic 并打开原界面，无开发服务器 | `node scripts/test-install.mjs`；artifacts/install/report.json；完整功能仍在移植，不能称为最终包 |

验证环境：ZTools app.asar `3.3.0-beta.2` + 独立 Electron `42.3.3`、Chromium `148`、Node `24.15.0`，使用随机临时数据目录。源代码宿主与安装包自带运行时的兼容比较仍需单列，不能把该组合推广为所有 ZTools 版本。
