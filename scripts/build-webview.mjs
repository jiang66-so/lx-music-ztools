import webpack from 'webpack'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { resolve } from 'node:path'
const require = createRequire(import.meta.url)
const config = require('../build-config/ztools/webpack.config.cjs')
const adapter = name => resolve('src/webview', name)
await mkdir('dist-webview', { recursive: true })
const worker = await build({ entryPoints: ['src/source-worker.js'], bundle: true, platform: 'browser', write: false, format: 'iife',
  alias: { stream: 'stream-browserify', events: 'events' }, define: { global: 'globalThis' }, inject: ['src/worker-shims.js'],
  banner: { js: `for(const name of ['Worker','SharedWorker','importScripts'])Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false});` } })
await writeFile('dist-webview/worker-source.txt', worker.outputFiles[0].text)
config.resolve.alias['@webview/source-worker$'] = resolve('dist-webview/worker-source.txt')
config.module.rules.push({ test: /worker-source\.txt$/, type: 'asset/source' })
config.entry = { lx: adapter('entry.ts') }
config.output.path = resolve('dist-webview/dist')
config.output.clean = true
config.plugins = config.plugins.filter(plugin => plugin.constructor.name !== 'HtmlWebpackPlugin')
const HTMLPlugin = require('html-webpack-plugin')
config.plugins.push(new HTMLPlugin({ filename: 'lx.html', template: resolve('vendor/lx/src/renderer/index.html'), chunks: ['lx'] }))
// Replace only the WebView variant. Formal Node preload packaging remains intact.
config.plugins.push(new webpack.NormalModuleReplacementPlugin(/.*/, resource => {
  if (resource.request === 'node:events') { resource.request = require.resolve('events/'); return }
  const absolute = resource.request.startsWith('.') ? resolve(resource.context, resource.request) : resource.request
  if (/[\\/]SettingAbout\.vue$/.test(absolute)) { resource.request = adapter('SettingAbout.vue'); return }
  if (absolute.endsWith('/src/ztools/entry.ts') || absolute.endsWith('\\src\\ztools\\entry.ts')) resource.request = adapter('entry.ts')
  if (/[\\/]Setting(?:Sync(?:[\\/]index\.vue)?|(?:OpenAPI|DesktopLyric|Download|Network|HotKey|Update)\.vue)$/.test(absolute) || /[\\/]renderer[\\/]views[\\/]Download(?:[\\/]index\.vue)?$/.test(absolute)) resource.request = adapter('CapabilityNotice.vue')
}))
await mkdir(config.output.path, { recursive: true })
await new Promise((resolve, reject) => webpack(config, (error, stats) => {
  if (error || stats.hasErrors()) reject(error || new Error(stats.toString('errors-only')))
  else { console.log('WebView renderer built'); resolve() }
}))
const manifest = JSON.parse(await readFile('src-ztools/plugin.json', 'utf8'))
delete manifest.preload
manifest.name = 'lx-music-ztools-webview'
manifest.title = 'LX Music WebView'
manifest.version = '0.1.2-webview.0'
manifest.description = '无 Node 本地实验版：原 LX 界面、浏览器存储及自定义音源；网络受 WebView CORS 限制'
manifest.features = [manifest.features[0]]
manifest.features[0].cmds = ['LX Music WebView', 'lxwebview', '洛雪音乐 WebView']
await writeFile('dist-webview/plugin.json', JSON.stringify(manifest, null, 2) + '\n')
for (const file of ['logo.png', 'LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.txt']) await cp('src-ztools/' + file, 'dist-webview/' + file)
console.log('dist-webview/plugin.json (no preload / no Node runtime)')
