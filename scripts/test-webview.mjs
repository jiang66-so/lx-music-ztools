import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'

const root = resolve('dist-webview')
await readFile(resolve(root, 'plugin.json')) // Fail before browser launch if build is missing.
const errors = []
let rawSourceRequests = 0
const server = createServer(async (req, res) => {
  if (req.url === '/raw-source-forbidden') { rawSourceRequests++; res.end('unexpected'); return }
  if (req.url === '/source-url') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/fixture.wav` })); return }
  if (req.url === '/fixture.wav') {
    const data = Buffer.alloc(44 + 44100 * 2 * 6)
    data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8)
    data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
    data.writeUInt32LE(44100, 24); data.writeUInt32LE(88200, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34)
    data.write('data', 36); data.writeUInt32LE(data.length - 44, 40)
    for (let i = 44; i < data.length; i += 2) data.writeInt16LE(Math.round(Math.sin((i - 44) / 2 * 440 * 2 * Math.PI / 44100) * 800), i)
    res.writeHead(200, { 'Content-Type': 'audio/wav', 'Access-Control-Allow-Origin': '*' }); res.end(data); return
  }
  if (req.url?.startsWith('/api/search/music/list')) {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ code: 200, data: { total: 1, list: [{ rid: 12345, name: 'WebView 验证曲', artist: '受控测试', album: '无 Node', duration: 6, pic: '' }] } })); return
  }
  try {
    const target = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname))
    if (!target.startsWith(root + '/') && !target.startsWith(root + '\\')) throw new Error('path')
    const data = await readFile(target)
    res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' })[extname(target)] || 'application/octet-stream')
    res.end(data)
  } catch { res.writeHead(404); res.end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const corsServer = createServer((req, res) => { res.end('no CORS headers') })
await new Promise(done => corsServer.listen(0, '127.0.0.1', done))
const corsOrigin = `http://127.0.0.1:${corsServer.address().port}`
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true })
const page = await context.newPage()
page.on('pageerror', error => { errors.push(error.message); console.error(error.stack) })
const checks = []
let passed = false
try {
  await page.route('**/*', async route => {
    const url = route.request().url()
    if (url.startsWith(origin) || url.startsWith(corsOrigin) || url.startsWith('blob:') || url.startsWith('data:')) return route.continue()
    if (url.startsWith('http://search.kuwo.cn/r.s?')) return route.fulfill({ json: { TOTAL: '1', SHOW: '1', abslist: [{ MUSICRID: 'MUSIC_12345', SONGNAME: 'WebView 验证曲', ARTIST: '受控测试', ALBUM: '无 Node', ALBUMID: '1', DURATION: '6', N_MINFO: 'level:standard,bitrate:128,format:mp3,size:1M' }] } })
    return route.fulfill({ json: {} })
  })
  await page.goto(origin + '/dist/lx.html')
  await page.waitForFunction(() => window.lxPlayer && window.lxCatalog && window.lxWebview, { timeout: 30000 })
  await page.waitForSelector('#root button', { timeout: 15000 })
  assert.deepEqual(await page.evaluate(() => [typeof window.require, typeof window.process, typeof window.Buffer, typeof window.services?.diagnose()?.node]), ['undefined', 'undefined', 'undefined', 'undefined'])
  checks.push('普通 Chromium 启动原 LX 界面，Node/Electron 全局不存在')
  const script = `/**\n * @name WebView 受控音源\n * @version 1.0.0\n */\nlx.on(lx.EVENT_NAMES.request, async () => {
    if(typeof require!=='undefined'||typeof process!=='undefined'||typeof localStorage!=='undefined'||typeof Worker!=='undefined')throw Error('isolation failed');
    let storageDenied=false;try{indexedDB.open('lx-music-webview-v1')}catch{storageDenied=true}if(!storageDenied)throw Error('source storage escaped sandbox');
    let denied=false;try{await fetch('${origin}/raw-source-forbidden')}catch{denied=true}if(!denied)throw Error('raw network escaped CSP');
    if(lx.utils.crypto.md5('webview').length!==32||lx.utils.buffer.from('ok').toString()!=='ok')throw Error('utils failed');
    return new Promise((resolve,reject)=>lx.request('${origin}/source-url',{},(error,response,body)=>error?reject(error):resolve(body.url)))
  });lx.send(lx.EVENT_NAMES.inited,{sources:{kw:{type:'music',actions:['musicUrl'],qualitys:['128k']}}})`
  const chooser = page.waitForEvent('filechooser')
  const selected = page.evaluate(() => window.lxHost.invoke('winMain_show_select_dialog', { properties: ['openFile'], filters: [{ extensions: ['js'] }] }))
  await (await chooser).setFiles({ name: 'webview-fixture.js', mimeType: 'text/javascript', buffer: Buffer.from(script) })
  const selection = await selected
  await page.evaluate(async path => {
    const bytes = await window.lxHost.invoke('files:call', { method: 'readFile', args: [path] })
    const { apiInfo } = await window.lxHost.invoke('winMain_import_user_api', new TextDecoder().decode(bytes))
    await window.lxHost.invoke('common_set_app_setting', { 'common.apiSource': apiInfo.id, 'common.isAgreePact': true, 'common.langId': 'zh-cn' })
    await window.lxHost.invoke('winMain_set_user_api', apiInfo.id)
  }, selection.filePaths[0])
  await page.waitForFunction(async () => (await window.lxHost.invoke('winMain_get_user_api_status')).status)
  checks.push('浏览器文件选择器导入 LX API 2.0 音源并初始化')
  const result = await page.evaluate(() => window.lxCatalog.search({ text: 'WebView', source: 'kw', page: 1 }))
  assert.equal(result.list.length, 1)
  const track = result.list[0]
  checks.push('原酷我搜索 SDK 转换受控 HTTP 响应并返回歌曲')
  await page.evaluate(async track => {
    await window.lxHost.invoke('player_list_music_add', { id: 'default', musicInfos: [track], addMusicLocationType: 'bottom' })
    await window.lxHost.invoke('player_list_music_add', { id: 'love', musicInfos: [track], addMusicLocationType: 'bottom' })
    await window.lxPlayer.dispatch({ type: 'playList', listId: 'default', index: 0 })
  }, track)
  await page.waitForFunction(() => window.lxPlayer.getState().progress > 0.3, { timeout: 20000 })
  checks.push('原播放器通过自定义音源解析并播放合成 WAV，进度推进')
  assert.equal(rawSourceRequests, 0)
  checks.push('音源 Worker 无 Node/存储/子 Worker，CSP 拒绝原始网络，lx.request 和 crypto/Buffer 可用')
  await page.evaluate(() => window.lxPlayer.dispatch({ type: 'pause' }))
  await page.getByText('WebView 实验版', { exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '浏览器下载当前歌曲' }).click()
  await page.waitForFunction(() => document.querySelector('details [role="status"]')?.textContent !== '正在获取歌曲文件…')
  console.log('Browser download status:', await page.locator('details [role="status"]').textContent())
  const download = await downloadPromise
  assert.match(download.suggestedFilename(), /\.wav$/)
  checks.push('浏览器下载当前歌曲，保存 WAV')
  const cors = await page.evaluate(async url => {
    try { await window.lxHost.invoke('network:fetch', { url }); return 'unexpected success' } catch (error) { return error.message }
  }, corsOrigin)
  assert.match(cors, /CORS/)
  checks.push('跨域未授权请求明确失败，未关闭安全策略或使用隐藏代理')
  await page.evaluate(() => window.lxHost.invoke('common_set_app_setting', { 'common.fontSize': 19, 'theme.id': 'black' }))
  await page.reload()
  await page.waitForFunction(() => window.lxPlayer && window.lxCatalog)
  const restored = await page.evaluate(async () => ({ font: (await window.lxHost.invoke('common_get_app_setting'))['common.fontSize'], theme: (await window.lxHost.invoke('common_get_app_setting'))['theme.id'], sources: (await window.lxHost.invoke('winMain_get_user_api_list')).length, love: (await window.lxHost.invoke('player_list_music_get', 'love')).length }))
  assert.deepEqual(restored, { font: 19, theme: 'black', sources: 1, love: 1 })
  await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '19px')
  await page.evaluate(() => window.lxHost.invoke('common_set_app_setting', { 'theme.id': 'green' }))
  checks.push('IndexedDB 刷新后恢复音源、收藏、主题、字号，根字号实测 19px')
  const unsupported = await page.evaluate(async () => {
    try { await window.lxHost.invoke('common_set_app_setting', { 'sync.enable': true }); return 'unexpected' } catch (error) { return error.message }
  })
  assert.match(unsupported, /尚不支持/)
  await page.evaluate(async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => window.lxHost.invoke('winMain_save_data', { path: 'serial-' + i, data: i })))
    for (let i = 0; i < 20; i++) if (await window.lxHost.invoke('winMain_get_data', 'serial-' + i) !== i) throw Error('lost write')
  })
  checks.push('不支持的系统服务拒绝启用；并发保存串行落盘无丢失')
  const lifecycle = await page.evaluate(async () => {
    const original = (await window.lxHost.invoke('winMain_get_user_api_list'))[0].id
    const { apiInfo: slow } = await window.lxHost.invoke('winMain_import_user_api', '/**\n * @name 请求取消验证\n */\nlx.on(lx.EVENT_NAMES.request,()=>new Promise(()=>{}));lx.send(lx.EVENT_NAMES.inited,{sources:{kw:{type:"music",actions:["musicUrl"],qualitys:["128k"]}}})')
    await window.lxHost.invoke('winMain_set_user_api', slow.id)
    const request = key => window.lxHost.invoke('winMain_request_user_api', { requestKey: key, data: { action: 'musicUrl', source: 'kw', info: { type: '128k', musicInfo: {} } } }).then(() => 'unexpected', error => error.message)
    const first = request('cancel-test')
    await window.lxHost.invoke('winMain_request_user_api_cancel', 'cancel-test')
    const cancelled = await first
    const second = request('switch-test')
    await window.lxHost.invoke('winMain_set_user_api', original)
    const switched = await second
    const { apiInfo: bad } = await window.lxHost.invoke('winMain_import_user_api', '/**\n * @name 失败恢复验证\n */\nthrow Error("fixture init failed")')
    let failed = ''
    try { await window.lxHost.invoke('winMain_set_user_api', bad.id) } catch (error) { failed = error.message }
    const status = await window.lxHost.invoke('winMain_get_user_api_status')
    await window.lxHost.invoke('winMain_set_user_api', original)
    await window.lxHost.invoke('winMain_remove_user_api', [slow.id, bad.id])
    return { cancelled, switched, failed, rawScriptLeaked: Boolean(status.apiInfo?.script), frames: document.querySelectorAll('iframe').length }
  })
  assert.match(lifecycle.cancelled, /取消/)
  assert.match(lifecycle.switched, /切换/)
  assert.match(lifecycle.failed, /fixture init failed/)
  assert.equal(lifecycle.rawScriptLeaked, false)
  assert.equal(lifecycle.frames, 1)
  checks.push('取消/切源拒绝旧请求，初始化失败后可恢复，公开状态无脚本正文，保留单个沙箱')
  await mkdir('artifacts/webview', { recursive: true })
  await page.screenshot({ path: 'artifacts/webview/original-ui.png' })
  await page.evaluate(() => { location.hash = '/setting' })
  await page.getByRole('tab', { name: '基本设置', exact: true }).waitFor()
  for (const name of ['数据同步', '开放 API', '桌面歌词设置', '下载设置', '快捷键设置', '网络设置', '软件更新']) {
    await page.getByRole('tab', { name, exact: true }).click()
    await page.getByRole('heading', { name: 'WebView 无 Node 实验版', exact: true }).waitFor()
  }
  await page.getByRole('tab', { name: '关于 LX Music', exact: true }).click()
  await page.getByText('落雪无痕（lyswhut）', { exact: true }).waitFor()
  await page.getByText('jiang66-so', { exact: true }).waitFor()
  await page.screenshot({ path: 'artifacts/webview/settings-about.png' })
  checks.push('七个受限设置分区展示说明，关于页面保留 By / From 并标注未发布')
  const offline = await context.newPage()
  offline.on('pageerror', error => errors.push(error.message))
  await offline.goto(pathToFileURL(resolve(root, 'dist/lx.html')).href)
  await offline.waitForFunction(() => window.lxPlayer && window.lxCatalog)
  const localStatus = await offline.evaluate(async () => {
    const script = '/**\n * @name 本地文件验证\n */\nlx.on(lx.EVENT_NAMES.request,async()=>"https://example.invalid/test.mp3");lx.send(lx.EVENT_NAMES.inited,{sources:{kw:{type:"music",actions:["musicUrl"],qualitys:["128k"]}}})'
    const { apiInfo } = await window.lxHost.invoke('winMain_import_user_api', script)
    await window.lxHost.invoke('winMain_set_user_api', apiInfo.id)
    return (await window.lxHost.invoke('winMain_get_user_api_status')).status
  })
  assert.equal(localStatus, true)
  checks.push('直接 file:// 打开原界面并初始化音源，无本地 HTTP/Node 服务')
  await offline.close()
  assert.deepEqual(errors, [])
  passed = true
  console.log(JSON.stringify({ pass: true, checks, errors }, null, 2))
} finally {
  await mkdir('artifacts/webview', { recursive: true })
  await writeFile('artifacts/webview/report.json', JSON.stringify({ pass: passed, checks, errors }, null, 2))
  await browser.close(); server.closeAllConnections(); corsServer.closeAllConnections(); await Promise.all([new Promise(done => server.close(done)), new Promise(done => corsServer.close(done))])
}
