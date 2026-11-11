# 无 Node WebView 本地实验版

分支：`codex/webview-no-node`，基于 `d471abb`。按用户最新授权，仅提交并推送 GitHub 同名实验分支，不发布市场。用户没有 Java 版宿主，且明确不要求该宿主验证。

## 选择和边界

保留原 LX Vue 界面，另建浏览器后台适配器，用 IndexedDB 替代 SQLite、Fetch 替代 Node HTTP、沙箱 iframe 内的 Worker 执行自定义音源。构建时仍使用 npm/Node；安装包运行时不需要 Node、Electron、preload 或外置服务。

直接移除 preload 无法启动；附带 Node 服务违背本需求；完整 Java 后台需要未知宿主接口。因此先实现可直接打开的浏览器版本，保留 Node 正式版构建入口。

首轮保留音源文件/URL导入与管理、原五平台搜索代码、原播放器、列表与收藏、主题和字号持久化。文件导入、酷我搜索转换和播放通过受控浏览器验证；URL导入沿用原 UI 和浏览器 Fetch 路径，未单独做 UI 验收；其他四平台未在此分支重新做 LIVE 验收。网络遵守 WebView 的 CORS/混合内容/请求头策略，不通过关闭浏览器安全策略掩盖限制。缺少跨域许可的线上音源不能承诺可用。

同步、开放 API、本地路径访问、后台断点下载、独立桌面歌词等需要系统接口的项目保留明确限制说明。页面内歌词继续使用原播放器；不把没有能力的按钮报告为实现。IndexedDB 数据独立于正式版，不自动读取日常数据。音源保存在用户浏览器存储，不随安装包分发。

## 实施与验收

- [x] 独立构建/打包入口，产物 manifest 不含 preload。
- [x] 浏览器持久化与串行提交、设置/列表桥接。
- [x] 浏览器 HTTP 和音源沙箱；初始化、取消、切源、CSP 网络隔离受控 PASS；有超时终止逻辑，未等待 30 秒做超时专项。
- [x] 原 LX 界面启动、导入受控音源、搜索、解析、播放、刷新恢复。
- [x] 普通 Chromium（非 Electron，Node 全局不存在）验证，记录 CORS 等失败边界。
- [x] 本地 ZIP、说明和检查结果；代码在独立实验分支维护，不发布市场。

## 使用

```powershell
npm run build:webview
npm run test:webview
npm run pack:webview
```

开发入口：`dist-webview/plugin.json`。浏览器直接打开 `dist-webview/dist/lx.html`，不需要开发服务器。支持标准插件 manifest 的宿主可尝试导入本地 ZIP，使用 `lxwebview` 或 `LX Music WebView` 打开。该命令与正式版的 `lxmusic` 分开，数据也独立。未知 Java 宿主是否识别此 manifest、是否支持 Worker/Web Crypto/IndexedDB，不在验证结论中。

点击右上角「WebView 实验版」可查看限制，并用「浏览器下载当前歌曲」保存正在播放的在线歌曲。此模式将完整响应放入内存，不支持后台任务、断点续传、标签写入或大文件长期下载；页面关闭即结束播放与网络请求。隐藏插件是否保留页面由宿主决定。

## 当前未移植部分

| 功能 | 本分支状态 |
| --- | --- |
| LX 同步客户端/服务端、开放 API | 未提供；没有额外进程或 HTTP 监听服务。浏览器同步客户端后续仍可单独研究。 |
| 独立桌面歌词、系统快捷键、系统代理 | 设置分区显示限制说明；页面内歌词的原 UI/代码保留。 |
| 本地路径、元数据读取、写标签、目录选择 | 没有 Node 文件系统实现；文件选择器仅授予所选文件。 |
| 备份 | 可导出实验版 JSON（不含音源）；旧版备份恢复尚未接入，不能替代正式版备份功能。 |
| 不喜欢规则 | 持久化操作未移植，调用会明确报错。 |
| 多窗口/跨页面同步编辑 | 未支持；单页更新串行持久化，避免页内并发保存覆盖。 |

原 Node 正式版的构建、preload 和运行服务未改动。WebView 的两个 TypeScript 入口与原 LX 入口一样由 Webpack 适配并转译，不纳入框架 `vue-tsc` 对 vendor 原始类型的检查；通过普通浏览器运行验证，不能将框架类型检查描述为完整上游类型检查。

## 本地验证回执（2026-11-11）

`node scripts/test-webview.mjs`：12 项 PASS，页面脚本错误 0。覆盖无 Node 全局、文件导入、受控搜索/解析/播放、CSP 禁止原始网络与沙箱存储访问、`lx.request`/crypto/Buffer、浏览器 WAV 下载、真实浏览器 CORS 拒绝、刷新恢复主题/字号/收藏、20 次并发保存、请求取消/切源/失败恢复、7 个受限设置分区和署名、`file://` 直接启动与初始化。

`npm run test:ztools`：245 项，244 PASS、0 FAIL、1 项环境可选跳过。`npm run check:ztools` 通过。未对 Java 宿主、线上音源真实服务、人工听音、后台长时间播放和全部设置进行验收。

产物：`dist-webview-packages/lx-music-ztools-webview-0.1.2-webview.0.zip`，5,546,484 字节；90 个 ZIP 条目与被测构建逐文件 SHA256 一致。对用户目录 23 个去重音源的哈希排除扫描通过，音源未进入源码或 ZIP。

SHA256：`44d497c1d746c5df248cdb0bba550d4a1d1fd1b5c71ae4c518990094dea3ee90`

原始本地证据（忽略入库）：`artifacts/webview/report.json`、`package-audit.json`、`node-regression.log`、`original-ui.png`、`settings-about.png`。
