const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { createBridge } = require('../../src-ztools/preload/runtime/bridge.cjs')
const { createWindows, PARENT, CHILD } = require('../../src-ztools/preload/runtime/windows.cjs')
const { WIN_LYRIC_RENDERER_EVENT_NAME: names, WIN_MAIN_RENDERER_EVENT_NAME: mainNames } = require('../../src-ztools/preload/upstream/common/ipcNames.cjs')
function fixture(t) {
  const bridge = createBridge(), ipcRenderer = new EventEmitter(), calls = [], windows = []
  const lx = { appSetting: { ...require('../../src-ztools/preload/upstream/common/defaultSetting.cjs').default }, event_app: new EventEmitter() }
  lx.event_app.update_config = patch => { Object.assign(lx.appSetting, patch); lx.event_app.emit('updated_config', Object.keys(patch), patch) }
  const ztools = { getPrimaryDisplay: () => ({ workArea: { x: -1280, y: 0, width: 1280, height: 720 } }),
    getDisplayNearestPoint: () => ztools.getPrimaryDisplay(), createBrowserWindow(url, options) {
      const win = { url, bounds: { ...options }, dead: false, webContents: { id: 42, send: (...args) => calls.push(args) },
        destroy() { this.dead = true }, isDestroyed() { return this.dead }, getBounds() { return this.bounds },
        setBounds(bounds) { this.bounds = bounds }, setAlwaysOnTop: value => calls.push(['top', value]), setIgnoreMouseEvents: value => calls.push(['ignore', value]), setSkipTaskbar() {}, moveTop() {} }
      windows.push(win); return win
    } }
  const service = createWindows({ bridge, ipcRenderer, ztools, lx, ready: true })
  t.after(() => service.dispose())
  return { service, bridge, ipcRenderer, ztools, lx, calls, windows }
}
test('lyrics reuse original port messages and reject another window/session', async t => {
  const x = fixture(t), received = []
  x.bridge.subscribe(mainNames.process_new_desktop_lyric_client, () => received.push('connected'))
  x.bridge.subscribe('lyric:port:receive', data => received.push(data))
  await x.service.openLyrics()
  const win = x.windows[0], session = new URL(win.url, 'file:///').searchParams.get('session')
  const packet = { session, kind: 'invoke', id: '1', channel: names.request_main_window_channel }
  x.ipcRenderer.emit(PARENT, { senderId: 99 }, packet)
  assert.equal(received.length, 0)
  x.ipcRenderer.emit(PARENT, { senderId: 42 }, packet)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(received[0], 'connected')
  await x.bridge.invoke('lyric:port', { action: 'set_play', data: 1500 })
  assert.ok(x.calls.some(([channel, packet]) => channel === CHILD && packet.kind === 'event' && packet.params?.data === 1500))
  x.ipcRenderer.emit(PARENT, { senderId: 42 }, { session, kind: 'invoke', id: '2', channel: 'lyric:port', params: { action: 'get_info' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(received.at(-1).action, 'get_info')
  await x.service.closeLyrics()
  assert.equal(win.dead, true)
  await x.service.dispose()
  assert.equal(x.ipcRenderer.listenerCount(PARENT), 0)
})
test('lyrics clamp bounds to a negative-coordinate display and apply top/click-through', async t => {
  const x = fixture(t)
  x.lx.appSetting['desktopLyric.x'] = -20
  x.lx.appSetting['desktopLyric.y'] = 700
  x.lx.appSetting['desktopLyric.width'] = 900
  x.lx.appSetting['desktopLyric.height'] = 100
  x.lx.appSetting['desktopLyric.isLock'] = true
  x.lx.appSetting['desktopLyric.isAlwaysOnTop'] = true
  await x.service.openLyrics()
  const bounds = x.windows[0].bounds
  assert.equal(bounds.x, -900)
  assert.equal(bounds.y, 620)
  assert.ok(x.calls.some(call => call[0] === 'top' && call[1] === true))
  assert.ok(x.calls.some(call => call[0] === 'ignore' && call[1] === true))
})
