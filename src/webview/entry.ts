import '../ztools/contracts'
import '../ztools/shell.css'
import { createBridge } from '../../src-ztools/preload/runtime/bridge.cjs'
document.documentElement.classList.add('lx-ztools-shell')
void (async () => {
  const bridge = window.lxHost = createBridge()
  bridge.setSnapshot('host:env', { platform: 'win32', release: 'WebView', homedir: '', tmpdir: '', arch: 'browser', cpus: [] })
  const { initializeBrowserRuntime } = await import('./runtime')
  const runtime = await initializeBrowserRuntime(bridge)
  ;(window as any).lxWebview = runtime
  ;(window as any).dt = true
  // Use the real bridge when present; no Node API is emulated on window.
  const host = (window as any).ztools
  if (!host) (window as any).ztools = {
    isDarkColors: () => matchMedia('(prefers-color-scheme: dark)').matches,
    onThemeChange: listener => matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => listener({ isDark: event.matches })),
  }
  ;(window as any).services = { diagnose: () => ({ app: 'WebView', runtime: runtime.diagnostics() }), clipboardReadText: () => '' }
  ;(window as any).shouldUseDarkColors = window.ztools.isDarkColors?.() ?? matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.add('disableTransparent')
  document.documentElement.classList.remove('transparent')
  document.body.append((window as any).dom_style)
  await import('../../vendor/lx/src/renderer/main')
  await import('../ztools/theme.js')
  await import('../ztools/player.js')
  await import('../ztools/catalog.js')
  const note = document.createElement('details')
  note.style.cssText = 'position:fixed;right:10px;top:8px;font:12px system-ui;z-index:1000;color:#53665e;background:var(--color-main-background,#fff);border-radius:4px;padding:6px;max-width:320px'
  const summary = document.createElement('summary'); summary.textContent = 'WebView 实验版'; summary.style.cursor = 'pointer'
  const description = document.createElement('p'); description.textContent = '无 Node。跨域请求由 WebView 决定；同步、开放 API 和独立桌面歌词待宿主接口支持。'
  const save = document.createElement('button'); save.textContent = '浏览器下载当前歌曲'; save.style.cssText = 'margin-top:8px;padding:6px;cursor:pointer'
  const status = document.createElement('p'); status.role = 'status'
  let downloading = false
  save.onclick = async () => {
    if (downloading) return
    downloading = true; save.disabled = true; status.textContent = '正在获取歌曲文件…'
    try {
      const { playMusicInfo } = await import('../../vendor/lx/src/renderer/store/player/state')
      const track = playMusicInfo.musicInfo
      if (!track || track.source === 'local') throw new Error('请先播放一首在线歌曲')
      const setting = await window.lxHost.invoke<any>('common_get_app_setting')
      const resolved = await (window as any).lxCatalog.resolve(track, setting['player.playQuality'])
      const url = typeof resolved === 'string' ? resolved : resolved.url
      if (!/^https?:\/\//.test(url)) throw new Error('歌曲地址无效')
      const response = await window.lxHost.invoke<any>('network:fetch', { url, binary: true, timeout: 60000 })
      if (response.statusCode < 200 || response.statusCode >= 300) throw new Error('下载返回 HTTP ' + response.statusCode)
      const mime = response.headers['content-type']?.split(';')[0] || 'application/octet-stream'
      const extension = ({ 'audio/mpeg': 'mp3', 'audio/flac': 'flac', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg' })[mime] || 'audio'
      const player = (window as any).lxPlayer.getState()
      runtime.download(`${player.name || 'LX Music'} - ${player.singer || ''}.${extension}`, response.raw, mime)
      status.textContent = '已交给浏览器保存；本模式不支持断点续传和写入标签。'
    } catch (error) { status.textContent = error.message }
    finally { downloading = false; save.disabled = false }
  }
  note.append(summary, description, save, status)
  document.body.append(note)
})().catch(error => {
  console.error(error)
  document.body.replaceChildren()
  const text = document.createElement('p'); text.style.cssText = 'padding:24px;white-space:pre-wrap'
  text.textContent = 'WebView 版启动失败：' + error.message + '\n需要支持 IndexedDB、Worker、Web Crypto 的现代 WebView。'
  document.body.append(text)
})
