import defaultSetting from '../../vendor/lx/src/common/defaultSetting'
import defaultHotKey from '../../vendor/lx/src/common/defaultHotKey'
import themes from '../../vendor/lx/src/common/theme/index.json'
import { openStore } from './storage.js'
import { createNetwork } from './network.js'
import { createSources } from './sources.js'
import { Buffer } from 'buffer'
import { gzip, ungzip } from 'pako'

const clone = value => JSON.parse(JSON.stringify(value))
const unsupported = feature => { throw new Error(`无 Node WebView 尚不支持${feature}，需要宿主提供对应系统接口`) }
export async function initializeBrowserRuntime(bridge) {
  const store = await openStore()
  const network = createNetwork()
  const files = new Map<string, File>()
  const saves = new Map<string, string>()
  const saved = () => store.read()
  const settings = () => ({ ...clone(defaultSetting), 'common.transparentWindow': false, 'common.langId': 'zh-cn', ...saved().setting,
    'sync.enable': false, 'openAPI.enable': false, 'desktopLyric.enable': false })
  const reg = (name, handler) => bridge.register(name, handler)
  const win = (name, handler) => reg('winMain_' + name, handler)
  let player = { status: 'stoped', name: '', singer: '', albumName: '', picUrl: '', progress: 0, duration: 0, volume: 1, mute: false, playbackRate: 1, lyric: '', tlyric: '', rlyric: '', lxlyric: '' }
  bridge.setSnapshot('host:env', { platform: 'win32', release: 'WebView', homedir: '', tmpdir: '', arch: 'browser', cpus: [] })
  bridge.setSnapshot('host:addresses', [])
  bridge.setSnapshot('player:state', player)
  bridge.setSnapshot('common_get_app_setting', settings())
  const sources = createSources({ store, network, statusChanged: status => bridge.emit('winMain_user_api_status', status), alert: data => bridge.emit('winMain_user_api_show_update_alert', data) })
  reg('runtime:ready', () => true)
  reg('common_get_app_setting', settings)
  reg('common_set_app_setting', async patch => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置格式无效')
    for (const key of ['sync.enable', 'openAPI.enable', 'desktopLyric.enable', 'network.proxy.enable']) if (patch[key]) unsupported(key)
    const safe = Object.fromEntries(Object.entries(patch).filter(([key]) => Object.hasOwn(defaultSetting, key)))
    if (safe['common.fontSize'] != null && ![14, 15, 16, 17, 18, 19].includes(Number(safe['common.fontSize']))) throw new Error('字号无效')
    await store.update(state => Object.assign(state.setting, clone(safe)))
    bridge.setSnapshot('common_get_app_setting', settings()); bridge.emit('winMain_on_config_change', safe)
  })
  reg('common_get_env_params', () => ({ cmdParams: {}, deeplink: null }))
  reg('common_clear_env_params_deeplink', () => {})
  reg('common_get_system_fonts', () => ['Arial', 'Microsoft YaHei', 'SimSun', 'sans-serif', 'serif', 'monospace'])
  win('get_data', key => saved().data[key] ?? null)
  win('save_data', ({ path, data }) => store.update(state => { state.data[path] = clone(data) }))
  win('get_hot_key', () => clone(defaultHotKey))
  for (const kind of ['eq', 'convolution']) {
    win('get_sound_effect_' + kind + '_preset', () => saved().data['preset:' + kind] || [])
    win('save_sound_effect_' + kind + '_preset', value => store.update(state => { state.data['preset:' + kind] = clone(value) }))
  }
  win('get_themes', () => ({ themes, userThemes: saved().themes, dataPath: '' }))
  win('save_theme', theme => store.update(state => { if (!theme?.id || themes.some(item => item.id === theme.id)) throw new Error('主题 ID 无效'); state.themes = [...state.themes.filter(item => item.id !== theme.id), clone(theme)] }))
  win('remove_theme', id => store.update(state => { state.themes = state.themes.filter(item => item.id !== id) }))
  win('get_user_api_list', sources.list)
  win('import_user_api', sources.importScript)
  win('set_user_api', sources.activate)
  win('get_user_api_status', sources.getStatus)
  win('remove_user_api', async ids => { const result = await sources.remove(ids); if (ids.includes(saved().setting['common.apiSource'])) await bridge.invoke('common_set_app_setting', { 'common.apiSource': result[0]?.id || 'temp' }); return result })
  win('request_user_api', sources.request)
  win('request_user_api_cancel', sources.cancel)
  win('user_api_set_allow_update_alert', ({ id, enable }) => sources.setAllowUpdate(id, enable))
  reg('network:fetch', options => network.request(options).result)
  reg('network:cancel', network.cancel)
  reg('media:resource', url => { if (!/^https?:\/\//.test(url)) throw new Error('媒体 URL 无效'); return url })
  reg('dns:lookup', () => unsupported('DNS 解析；请使用域名连接'))
  win('player_status', patch => { player = { ...player, ...clone(patch) }; bridge.setSnapshot('player:state', player) })
  win('inited', () => bridge.setSnapshot('player:ready', true))
  reg('commands:ready', () => [])
  for (const name of ['update_check', 'set_window_size', 'player_action_set_buttons', 'set_power_save_blocker', 'set_ignore_mouse_events', 'change_tray']) win(name, () => ({ supported: false }))
  win('set_app_name', title => { document.title = title })
  for (const name of ['quit', 'close', 'min']) win(name, () => window.ztools?.outPlugin?.(name === 'quit'))
  win('open_api_action', action => { if (action.action === 'status' || !action.data?.enable) return { address: '', message: '无 Node WebView 无 HTTP 监听端口能力' }; unsupported('开放 API') })
  win('sync_action', () => unsupported('LX 同步'))
  win('sync_get_server_devices', () => [])
  for (const name of ['windows:openLyrics', 'windows:closeLyrics']) reg(name, () => unsupported('独立桌面歌词窗口'))
  reg('windows:status', () => ({ open: false, ready: false }))
  win('download_list_get', () => [])
  for (const name of ['download_list_add', 'download_list_update', 'download_list_remove', 'download_list_clear']) win(name, () => unsupported('后台断点下载；请使用浏览器下载'))
  reg('worker:download', () => unsupported('后台断点下载'))
  for (const [get, save, clear, count, bucket, field, fallback] of [
    ['get_music_url', 'save_music_url', 'clear_music_url', 'get_music_url_count', 'urls', 'url', ''],
    ['get_other_source', 'save_other_source', 'clear_other_source', 'get_other_source_count', 'other', 'list', []],
    ['get_lyric_raw', 'save_lyric_raw', 'clear_lyric_raw', 'get_lyric_raw_count', 'lyrics', 'lyrics', {}],
    ['get_lyric_edited', 'save_lyric_edited', 'clear_lyric_edited', 'get_lyric_edited_count', 'edited', 'lyrics', null],
  ] as any[]) {
    win(get, id => saved().cache[bucket]?.[id] ?? fallback)
    win(save, data => store.update(state => { (state.cache[bucket] ||= {})[data.id] = clone(data[field]) }))
    win(clear, () => store.update(state => { state.cache[bucket] = {} }))
    win(count, () => Object.keys(saved().cache[bucket] || {}).length)
  }
  win('get_palyer_lyric', id => ({ lyric: '', tlyric: '', rlyric: '', lxlyric: '', ...saved().cache.lyrics?.[id], ...saved().cache.edited?.[id] }))
  win('remove_lyric_edited', id => store.update(state => { delete state.cache.edited?.[id] }))
  win('get_cache_size', () => 0)
  win('clear_cache', () => store.update(state => { state.cache = {} }))
  const merge = (target, incoming, top = false) => { const ids = new Set(target.map(item => item.id)); const items = incoming.filter(item => { if (ids.has(item.id)) return false; ids.add(item.id); return true }); return top ? [...items, ...target] : [...target, ...items] }
  const reorder = (target, ids, position) => { const moving = ids.map(id => target.find(item => item.id === id)).filter(Boolean); const remaining = target.filter(item => !ids.includes(item.id)); remaining.splice(Math.max(0, Math.min(position, remaining.length)), 0, ...moving); return remaining }
  const changeList = (name, change, event = name) => reg('player_' + name, async data => { await store.update(state => change(state, clone(data))); bridge.emit('player_' + event, clone(data)) })
  reg('player_list_get', () => saved().lists)
  reg('player_list_music_get', id => saved().music[id] || [])
  reg('player_list_music_check_exist', ({ listId, musicInfoId }) => (saved().music[listId] || []).some(item => item.id === musicInfoId))
  reg('player_list_music_get_list_ids', id => Object.entries(saved().music).filter(([, list]: any) => list.some(item => item.id === id)).map(([id]) => id))
  changeList('list_add', (state, { position, listInfos }) => { for (const item of listInfos) if (['default', 'love', 'temp'].includes(item.id) || state.lists.some(info => info.id === item.id)) throw new Error('列表 ID 重复'); state.lists.splice(position < 0 ? state.lists.length : position, 0, ...listInfos); for (const info of listInfos) state.music[info.id] = [] })
  changeList('list_remove', (state, ids) => { state.lists = state.lists.filter(item => !ids.includes(item.id)); for (const id of ids) if (!['default', 'love', 'temp'].includes(id)) delete state.music[id] })
  changeList('list_update', (state, items) => { state.lists = state.lists.map(info => ({ ...info, ...items.find(item => item.id === info.id) })) })
  changeList('list_update_position', (state, { ids, position }) => { state.lists = reorder(state.lists, ids, position) })
  changeList('list_music_add', (state, { id, musicInfos, addMusicLocationType }) => { state.music[id] = merge(state.music[id] || [], musicInfos, addMusicLocationType === 'top') })
  changeList('list_music_move', (state, { fromId, toId, musicInfos, addMusicLocationType }) => { state.music[toId] = merge(state.music[toId] || [], musicInfos, addMusicLocationType === 'top'); state.music[fromId] = (state.music[fromId] || []).filter(item => !musicInfos.some(info => info.id === item.id)) })
  changeList('list_music_remove', (state, { listId, ids }) => { state.music[listId] = (state.music[listId] || []).filter(item => !ids.includes(item.id)) })
  changeList('list_music_update', (state, infos) => { for (const id of Object.keys(state.music)) state.music[id] = state.music[id].map(item => infos.find(info => info.id === item.id) || item) })
  changeList('list_music_update_position', (state, { listId, ids, position }) => { state.music[listId] = reorder(state.music[listId] || [], ids, position) })
  changeList('list_music_overwrite', (state, { listId, musicInfos }) => { state.music[listId] = merge([], musicInfos) })
  reg('player_list_music_clear', async ids => { ids = Array.isArray(ids) ? ids : [ids]; await store.update(state => { for (const id of ids) state.music[id] = [] }); bridge.emit('player_list_music_clear', ids) })
  reg('player_list_data_overwire', () => unsupported('完整旧版列表覆盖；当前支持列表导出'))
  reg('dislike_get_dislike_music_infos', () => ({ names: new Set(), musicNames: new Set(), singerNames: new Set(), rules: '' }))
  for (const name of ['add_dislike_music_infos', 'overwrite_dislike_music_infos', 'clear_dislike_music_infos']) reg('dislike_' + name, () => unsupported('不喜欢规则持久化'))
  win('show_select_dialog', options => new Promise(resolve => {
    if (options?.properties?.includes('openDirectory')) unsupported('目录访问')
    const input = document.createElement('input'); input.type = 'file'; input.multiple = options?.properties?.includes('multiSelections') || false
    const extensions = options?.filters?.flatMap(item => item.extensions).filter(item => item !== '*') || []
    if (extensions.length) input.accept = extensions.map(item => '.' + item).join(',')
    input.onchange = () => { const filePaths = Array.from(input.files || []).map(file => { const id = 'browser-file:/' + crypto.randomUUID() + '/' + file.name; files.set(id, file); return id }); input.remove(); resolve({ canceled: !filePaths.length, filePaths }) }
    input.oncancel = () => { input.remove(); resolve({ canceled: true, filePaths: [] }) }
    input.hidden = true; document.body.append(input); input.click()
  }))
  win('show_save_dialog', options => { const filePath = 'browser-save:/' + crypto.randomUUID(); saves.set(filePath, options?.defaultPath?.split(/[\\/]/).pop() || 'lx-export.json'); return { canceled: false, filePath } })
  const download = (name, body, type = 'application/octet-stream') => {
    const url = URL.createObjectURL(new Blob([body], { type }))
    const link = document.createElement('a'); link.href = url; link.download = name.replace(/[\\/:*?"<>|]/g, '_')
    // LX intercepts body anchor clicks to open desktop external links. Retarget this
    // native browser download at a shadow host so its default action is retained.
    const host = document.createElement('span'); host.hidden = true
    host.attachShadow({ mode: 'closed' }).append(link); document.body.append(host)
    link.click(); host.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  const fileCall = async (method, args) => {
    const [path, value] = args
    if (method === 'readFile') { const file = files.get(path); if (!file) throw new Error('请选择文件后重试'); return Buffer.from(await file.arrayBuffer()) }
    if (method === 'getFileStats') { const file = files.get(path); return file ? { isFile: true, isDirectory: false, size: file.size } : null }
    if (method === 'checkPath') return files.has(path)
    if (method === 'gzipData') return Buffer.from(gzip(typeof path === 'string' ? path : JSON.stringify(path)))
    if (method === 'gunzipData') return JSON.parse(new TextDecoder().decode(ungzip(path)))
    if (method === 'saveStrToFile' || method === 'saveLxConfigFile') { if (!saves.has(path)) throw new Error('请先选择保存位置'); download(saves.get(path), method === 'saveLxConfigFile' ? gzip(JSON.stringify(value)) : value); return }
    if (method === 'readLxConfigFile') { const bytes = await fileCall('readFile', [path]); let text; try { text = new TextDecoder().decode(ungzip(bytes)) } catch { text = bytes.toString('utf8') } return JSON.parse(text) }
    unsupported('文件操作 ' + method)
  }
  reg('files:call', ({ method, args }) => fileCall(method, args))
  reg('worker:main', async ({ method, args }) => {
    if (['saveStrToFile', 'saveLxConfigFile', 'readLxConfigFile'].includes(method)) return fileCall(method, args)
    if (['getMusicFilePic', 'getMusicFileLyric'].includes(method)) return null
    const workers = { ...await import('../../vendor/lx/src/renderer/worker/main/list'), ...await import('../../vendor/lx/src/renderer/worker/main/common') }
    if (typeof workers[method] !== 'function') unsupported('主 Worker 操作 ' + method)
    return workers[method](...args)
  })
  reg('backup:export', ({ path, kind }) => { const state = saved(); const content = { format: 'lx-webview-backup-v1', kind, settings: kind !== 'lists' ? state.setting : undefined, lists: kind !== 'settings' ? state.lists : undefined, music: kind !== 'settings' ? state.music : undefined }; download((saves.get(path) || 'lx-webview-backup.json').replace(/\.[^.]+$/, '') + '.json', JSON.stringify(content), 'application/json') })
  reg('backup:import', () => unsupported('备份恢复；当前为浏览器实验版，请先保留原备份'))
  reg('backup:exportText', () => unsupported('合并文本导出'))
  reg('host:clipboardWrite', text => navigator.clipboard.writeText(text))
  reg('host:openUrl', url => { if (!/^https?:\/\//.test(url)) throw new Error('只允许 HTTP(S) 链接'); window.open(url, '_blank', 'noopener,noreferrer') })
  reg('host:openDirectory', () => unsupported('打开系统目录'))
  const stop = async () => { sources.dispose(); network.dispose(); await store.close(); await bridge.dispose() }
  window.addEventListener('pagehide', () => { sources.dispose(); network.dispose() })
  return { bridge, stop, download, diagnostics: () => ({ type: 'browser', network: network.inspect(), source: sources.getStatus() }) }
}
