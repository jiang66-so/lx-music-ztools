const context = require('../context.cjs')
const win = require('../win-main.cjs')
const storage = require('./storage.cjs')
const { cancelRequests } = require('./request.cjs')
const { WIN_MAIN_RENDERER_EVENT_NAME: names } = require('../../upstream/common/ipcNames.cjs')

function createSync({ bridge = context.bridge } = {}) {
  if (!context.lx) throw new Error('LX runtime must be initialized before sync')
  // Eager load while preload still owns the Node realm. Never call original default,
  // which binds window close to disconnect (plugin hiding must retain sync).
  const original = require('../../upstream/main/modules/sync/index.cjs')
  const users = require('../../upstream/main/modules/sync/server/user/index.cjs')
  let mode = 'server', queue = Promise.resolve(), disposed = false
  const listeners = new Set()
  const clone = value => structuredClone(value)
  const getStatus = () => ({ mode, ...clone(mode === 'server' ? original.getServerStatus() : original.getClientStatus()) })
  const off = bridge.subscribe(names.sync_action, event => {
    if (event.action !== `${mode}_status`) return
    const status = { mode, ...clone(event.data) }
    for (const listener of listeners) listener(clone(status))
  })
  const serial = fn => {
    const result = queue.then(fn)
    queue = result.catch(() => {})
    return result
  }
  const stopNow = async () => {
    cancelRequests()
    win.removeSelectModeListener(); win.sendCloseSelectMode()
    await original.disconnectServer()
    await original.stopServer()
    users.releaseUserSpace('default', true)
    await storage.flush()
  }
  const start = config => serial(async () => {
    if (disposed) throw new Error('同步服务已终止')
    if (!config || !['server', 'client'].includes(config.mode)) throw new Error('Invalid sync mode')
    if (config.enable === false) { await stopNow(); return getStatus() }
    let port
    if (config.mode === 'server') {
      if (!/^[0-9]+$/.test(String(config.port))) throw new Error('Invalid sync port / 端口无效')
      port = Number(config.port)
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid sync port / 端口无效')
    } else {
      const url = new URL(config.host)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP(S) sync hosts are supported')
    }
    await stopNow(); mode = config.mode
    try {
      if (mode === 'server') {
        await original.startServer(port)
        if (!original.getServerStatus().status) throw new Error(original.getServerStatus().message || '同步服务启动失败')
      } else await original.connectServer(config.host, config.authCode)
    } catch (error) {
      await stopNow()
      const status = mode === 'server' ? original.getServerStatus() : original.getClientStatus()
      status.message = error.message
      bridge.emit(names.sync_action, { action: `${mode}_status`, data: clone(status) })
      throw error
    }
    return getStatus()
  })
  const stop = () => serial(async () => { await stopNow(); return getStatus() })
  const action = async ({ action, data }) => {
    switch (action) {
      case 'enable_server': return start({ mode: 'server', ...data })
      case 'enable_client': return start({ mode: 'client', ...data })
      case 'get_server_status': return clone(original.getServerStatus())
      case 'get_client_status': return clone(original.getClientStatus())
      case 'generate_code': return original.generateCode()
      case 'select_mode': return win.chooseSyncMode(data.mode, data.type)
      default: throw new Error(`Unknown sync action: ${action}`)
    }
  }
  return { start, stop, getStatus, action,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    devices: () => original.getServerDevices().then(clone),
    removeDevice: clientId => original.removeServerDevice(clientId),
    async dispose() { if (disposed) return; disposed = true; await stop(); off(); listeners.clear() },
  }
}
module.exports = { createSync }
