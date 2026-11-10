// Host lifecycle fixes only. Protocol, RPC, cryptography and merge algorithms
// remain the original LX implementation. Shape checks fail closed on upgrades.
function replaceOnce(source, from, to, name) {
  if (!source.includes(from) || source.indexOf(from) !== source.lastIndexOf(from)) throw new Error(`LX sync source shape changed: ${name}`)
  return source.replace(from, to)
}
function adaptSyncSource(relativePath, source) {
  source = source.replaceAll('\r\n', '\n')
  const file = relativePath.replaceAll('\\', '/')
  if (!file.startsWith('main/modules/sync/')) return source
  const patch = (from, to, name) => { source = replaceOnce(source, from, to, `${file}: ${name}`) }
  if (file.endsWith('/server/user/data.ts') || file.endsWith('/snapshotDataManage.ts')) {
    patch("import { throttle } from '@common/utils/common'", "import { throttle, writeFile, serial } from '@ztools/sync/storage'", 'managed throttle')
    source = source.replaceAll('fs.writeFile(', 'writeFile(')
  }
  if (file.endsWith('/snapshotDataManage.ts')) {
    patch('  clearOldSnapshot = async() => {', '  clearOldSnapshot = serial(async() => {', 'serialize snapshot maintenance')
    patch('  }\n\n  updateDeviceSnapshotKey', '  }, () => this)\n\n  updateDeviceSnapshotKey', 'share snapshot manager critical section')
    patch('this.snapshotInfo.list.filter(key => !this.isIncluedsDevice(key))', 'this.snapshotInfo.list.filter(key => key !== this.snapshotInfo.latest && !this.isIncluedsDevice(key))', 'protect latest during pruning')
    patch(`      if (name) {
        await this.removeSnapshot(name)
        this.snapshotInfo.list.splice(this.snapshotInfo.list.indexOf(name), 1)`, `      if (name) {
        if (name === this.snapshotInfo.latest || this.isIncluedsDevice(name)) continue
        await this.removeSnapshot(name)
        const index = this.snapshotInfo.list.indexOf(name)
        if (index >= 0) this.snapshotInfo.list.splice(index, 1)`, 'recheck protection and valid history index')
  }
  if (file.endsWith('/server/modules/list/manage.ts') || file.endsWith('/server/modules/dislike/manage.ts')) {
    source = "import { serial } from '@ztools/sync/storage'\n" + source
    patch('  createSnapshot = async() => {', '  createSnapshot = serial(async() => {', 'serialize snapshot creation')
    patch('  }\n\n  getCurrentListInfoKey', '  }, () => this.snapshotDataManage)\n\n  getCurrentListInfoKey', 'share snapshot creation critical section')
  }
  if (file.endsWith('/client/data.ts')) {
    patch('    void saveSyncAuthKeys()', '    await saveSyncAuthKeys()', 'persist initial auth state')
    patch('  void saveSyncAuthKeys()', '  await saveSyncAuthKeys()', 'persist updated auth state')
  }
  if (file === 'main/modules/sync/client/index.ts') {
    patch('let connectId = 0', 'let connectId = 0\nexport const cancelPendingConnect = () => { connectId++ }', 'invalidate pending authentication before queued stop')
    patch('  await migrateData(global.lxDataPath)\n\n  return handleConnect', '  await migrateData(global.lxDataPath)\n  if (id != connectId) return\n\n  return handleConnect', 'preserve connection generation across migration')
  }
  if (file.endsWith('/client/auth.ts')) {
    patch("  console.log('connect: ', urlInfo.href, authCode)", "  // Credentials never enter host logs.", 'redact authentication code')
    patch('    void setSyncAuthKey(serverId, info)', '    await setSyncAuthKey(serverId, info)', 'persist authentication before success')
  }
  if (file.endsWith('/server/server/server.ts')) {
    patch('export const startServer = async(port: number) => {', 'export const startServer = async(port: number, isCurrent: () => boolean = () => true) => {', 'accept host startup generation')
    patch('  await migrateData(global.lxDataPath)\n  await initServerInfo()', '  await migrateData(global.lxDataPath)\n  if (!isCurrent()) return\n  await initServerInfo()\n  if (!isCurrent()) return', 'cancel obsolete server preflight before listening')
    patch("    log.warn(err)\n    return", "    log.warn(err)\n    socket.close(SYNC_CLOSE_CODE.failed)\n    return", 'failed module never becomes connected')
    patch("httpServer.on('error', error => {\n    console.log(error)\n    reject(error)", "httpServer.on('error', error => {\n    clearInterval(interval)\n    wss?.close()\n    wss = null\n    for (const socket of sockets) socket.destroy()\n    sockets.clear()\n    reject(error)", 'startup failure cleanup')
    patch(`const handleStopServer = async() => new Promise<void>((resolve, reject) => {
  if (!wss) return
  for (const client of wss.clients) client.close(SYNC_CLOSE_CODE.normal)
  unregisterLocalSyncEvent()
  wss.close()
  wss = null
  httpServer.close((err) => {
    if (err) {
      reject(err)
      return
    }
    resolve()
  })
  for (const socket of sockets) socket.destroy()
  sockets.clear()
})`, `const handleStopServer = async() => {
  const server = wss
  if (!server) return
  unregisterLocalSyncEvent()
  wss = null
  const websocketClosed = new Promise<void>(resolve => server.close(() => resolve()))
  const httpClosed = new Promise<void>((resolve, reject) => httpServer.close(err => err ? reject(err) : resolve()))
  for (const client of server.clients) client.close(SYNC_CLOSE_CODE.normal)
  for (const socket of sockets) socket.destroy()
  sockets.clear()
  await Promise.all([websocketClosed, httpClosed])
}`, 'await complete websocket shutdown')
    patch('if (!status.status) {', 'if (!status.status && !wss) {', 'failed listener can stop')
    patch("status.message = ''\n    status.address = []\n    status.code = ''\n  }).catch", "status.message = ''\n    status.address = []\n    status.code = ''\n    status.devices = []\n  }).catch", 'clear connected device status')
  }
  if (file.endsWith('/server/server/sync/sync.ts')) {
    patch('await modules[moduleName].sync(socket).catch(_ => _)', 'await modules[moduleName].sync(socket)', 'propagate failed business commit')
  }
  if (file.endsWith('/client/sync/handler.ts')) {
    const count = source.split('        return features').length - 1
    if (count !== 2) throw new Error(`LX sync feature negotiation shape changed: ${file}`)
    source = source.replaceAll('        return features', '        socket.feature = features\n        return features')
  }
  if (file.endsWith('/server/user/index.ts')) {
    patch('users.delete(userName)\n  }, delayTime)', 'delayReleaseTimeouts.delete(userName)\n    users.delete(userName)\n  }, delayTime)', 'release timer bookkeeping')
  }
  if (file.endsWith('/client/client.ts')) {
    // Each closure owns its socket. Late crypto/messages can no longer send to,
    // mark ready, or close a newer connection held in the module-level variable.
    const begin = source.indexOf('export const connect = ')
    const end = source.indexOf('export const disconnect = ')
    if (begin < 0 || end < begin) throw new Error('LX sync client connect shape changed')
    let connect = source.slice(begin, end)
    connect = replaceOnce(connect, '  client = new WebSocket(', '  const socket = new WebSocket(', 'socket ownership')
    connect = connect.replace(/\bclient\b/g, 'socket')
    connect = replaceOnce(connect, '  socket.data = {', '  client = socket\n  socket.data = {', 'publish active socket')
    connect = replaceOnce(connect, '      finished() {', `      finished() {
        if (client !== socket) return
        if (Object.keys(socket.feature ?? {}).some(name => !socket.moduleReadys?.[name])) {
          sendSyncStatus({ status: false, message: 'Sync module failed' })
          socket.close(SYNC_CLOSE_CODE.failed)
          throw new Error('Sync module failed')
        }`, 'reject premature finished')
    connect = connect.replace('      return [socket, ...rawArgs]', "      if (client !== socket) throw new Error('stale sync connection')\n      return [socket, ...rawArgs]")
    connect = connect.replace("  socket.addEventListener('open', () => {", "  socket.addEventListener('open', () => {\n    if (client !== socket) return")
    connect = connect.replace("  socket.addEventListener('error', ({ message }) => {", "  socket.addEventListener('error', ({ message }) => {\n    if (client !== socket) return")
    connect = connect.replace('    switch (code) {', '    if (client !== socket) return\n    switch (code) {')
    source = source.slice(0, begin) + connect + source.slice(end)
    patch("  client.close(SYNC_CLOSE_CODE.normal)\n  client = null\n  heartbeatTools.clearTimeout()\n  heartbeatTools.failedNum = 0", "  const socket = client\n  client = null\n  heartbeatTools.clearTimeout()\n  heartbeatTools.failedNum = 0\n  await new Promise<void>(resolve => {\n    if (socket.readyState === WebSocket.CLOSED) { resolve(); return }\n    const timer = setTimeout(() => socket.terminate(), 1000)\n    socket.once('close', () => { clearTimeout(timer); resolve() })\n    socket.close(SYNC_CLOSE_CODE.normal)\n  })", 'wait close before reconfigure')
    patch("    socket.on('open', () => {", "    socket.on('open', () => {\n      if (client !== socket) return", 'stale heartbeat open')
    patch("    socket.on('ping', () => {", "    socket.on('ping', () => {\n      if (client !== socket) return", 'stale heartbeat ping')
    patch("    socket.on('close', (code) => {", "    socket.on('close', (code) => {\n      if (client !== socket) return", 'stale heartbeat reconnect')
  }
  return source
}
module.exports = { adaptSyncSource }
