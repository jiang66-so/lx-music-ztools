# LX Music for ZTools

当前为 **0.0.1 框架验证版**，包含插件入口、生命周期、preload 诊断和插件存储验证。音乐搜索、音源、播放、下载与同步尚未移植。

## 开发与安装

```powershell
npm ci
npm run dev
```

在 ZTools 开发者工具中选择 `src-ztools/plugin.json` 并安装开发模式。输入「洛雪音乐」「LX Music」或「lxmusic」打开插件。

```powershell
npm run pack
```

构建输出为 `src-ztools/dist`；**完整运行目录是 `src-ztools`**，其中包含 plugin.json、logo.png、preload 和 dist。ZIP 输出到工作目录同级的 `output/lx-music-ztools`，可在 ZTools 本地安装。生产运行不依赖开发服务器。

## 验证

- `npm run build`：类型检查、前端构建、插件安装目录校验。
- `npm run test:publish`：调用官方 CLI 1.3.2，在新临时 Git 仓库中两次发布；GitHub 和认证被替换成测试响应，不创建线上 PR。
- `npm run test:host`：使用独立 Electron 运行本机 ZTools app.asar，测试数据写入独立临时目录。通过 `ZTOOLS_EXECUTABLE` 指定 Electron 可执行文件，通过 `ZTOOLS_APP` 指定 ZTools app.asar；两者均需已存在。宿主测试不使用用户真实配置。

截图和 JSON 报告放在同级 `output/lx-music-ztools`。

## 真实发布

```powershell
gh auth status
npm run pack
git add .
git commit -m "chore: prepare release"
npm run publish:plugin
```

发布包装器复用已登录的 gh 凭据，仅替换官方 CLI 的认证入口；其余发布校验、Fork、同步、提交、推送和 Draft PR 由官方 CLI 执行。缓存位于 `~/.config/ztools/lx-music-ztools`，凭据仅用于当前进程，完成后清除缓存 remote URL 中的凭据。

CLI 1.3.2 要求版本日志标题 `## 0.0.1 - YYYY-MM-DD`、非默认图标以及干净的 Git 工作区。该版本会从最新 upstream/main 重建发布分支，并使用精确 force-with-lease 防止覆盖竞态提交；这与官网页面旧版“只追加、不改写”的描述不同。

Draft PR 创建后仍需补充截图并审核自检清单。框架验证版保持 Draft，不宣称已完成音乐功能。

## 来源与许可

框架来自 ZTools 官方 Vue + TypeScript + Vite 模板。图标来自 lyswhut/lx-music-desktop，保留其 LICENSE；此项目为第三方移植开发，不是 LX 官方发行版。
