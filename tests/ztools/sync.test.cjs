const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { once } = require('node:events')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createBridge } = require('../../src-ztools/preload/runtime/bridge.cjs')
const { initializeRuntime } = require('../../src-ztools/preload/runtime/index.cjs')

test('sync is opt-in, validates ports, serializes lifecycle, cleans failed listeners and does not bind window close', { timeout: 15000 }, async t => {
  const { createSync } = require('../../src-ztools/preload/runtime/sync/index.cjs')
  const bridge = createBridge()
  const runtime = initializeRuntime({ bridge, directory: mkdtempSync(join(tmpdir(), 'lx-sync-unit-')) })
  const sync = runtime.sync || createSync({ bridge })
  t.after(async () => { await sync.dispose(); await runtime.dispose() })
  const context = require('../../src-ztools/preload/runtime/context.cjs')
  assert.equal(sync.getStatus().status, false)
  assert.equal(context.lx.event_app.listenerCount('main_window_close'), 0)
  for (const port of ['NaN', 0, -1, 65536, '12.4', ' 123 ']) await assert.rejects(sync.start({ mode: 'server', enable: true, port }), /port|端口/)
  const reservation = http.createServer()
  t.after(() => reservation.listening ? new Promise(resolve => reservation.close(resolve)) : undefined)
  reservation.listen(0, '0.0.0.0'); await once(reservation, 'listening')
  const port = reservation.address().port
  await assert.rejects(sync.start({ mode: 'server', port: String(port) }), /EADDRINUSE|in use/)
  assert.match(sync.getStatus().message, /EADDRINUSE|in use/)
  await new Promise(resolve => reservation.close(resolve))
  const snapshots = []
  const off = sync.subscribe(status => snapshots.push(status))
  await sync.start({ mode: 'server', port })
  assert.equal(sync.getStatus().status, true)
  assert.match(await (await fetch(`http://127.0.0.1:${port}/hello`)).text(), /Hello.*v4/)
  context.lx.event_app.emit('main_window_close')
  assert.equal(sync.getStatus().status, true)
  await Promise.all([sync.stop(), sync.start({ mode: 'server', port }), sync.stop()])
  assert.equal(sync.getStatus().status, false)
  assert.equal(snapshots.some(s => s.status), true)
  assert.equal(snapshots.find(s => s.status).status, true, 'historical snapshots remain immutable')
  off()
  reservation.listen(port); await once(reservation, 'listening')
  await new Promise(resolve => reservation.close(resolve))
})

test('sync HTTP adapter preserves raw numeric/base64 text and cancels its own pending authentication', async t => {
  const context = require('../../src-ztools/preload/runtime/context.cjs')
  const { createNetwork } = require('../../src-ztools/preload/runtime/network.cjs')
  const { httpFetch, cancelRequests } = require('../../src-ztools/preload/runtime/sync/request.cjs')
  const network = createNetwork()
  context.lx = { network }
  const sockets = new Set()
  const server = http.createServer((req, res) => { if (req.url === '/pending') return; res.end(req.url === '/numeric' ? '123456' : 'YWJjZA==') })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { network.dispose(); context.lx = null; for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal((await httpFetch(base + '/numeric')).body, '123456')
  assert.equal((await httpFetch(base + '/base64')).body, 'YWJjZA==')
  const pending = httpFetch(base + '/pending')
  cancelRequests()
  await assert.rejects(pending, /取消/)
})

test('sync storage flush persists the latest throttled state and propagates write failures', async () => {
  const fs = require('node:fs')
  const { throttle, writeFile, flush } = require('../../src-ztools/preload/runtime/sync/storage.cjs')
  const directory = mkdtempSync(join(tmpdir(), 'lx-sync-storage-'))
  const file = join(directory, 'snapshot.json')
  const save = throttle(value => writeFile(file, value, () => {}), 10000)
  save('first'); save('latest')
  await flush()
  assert.equal(fs.readFileSync(file, 'utf8'), 'latest')
  writeFile(join(directory, 'missing', 'devices.json'), '{}', () => {})
  await assert.rejects(flush(), /认证数据保存失败/)
})

test('sync host patches reject upstream source drift and retain wire/merge modules byte-for-byte', () => {
  const { adaptSyncSource } = require('../../src-ztools/preload/runtime/sync/adapt-source.cjs')
  const fs = require('node:fs')
  const root = join(__dirname, '../../vendor/lx/src/')
  for (const file of ['main/modules/sync/server/server/auth.ts', 'main/modules/sync/server/modules/list/sync/sync.ts', 'main/modules/sync/server/modules/dislike/sync/sync.ts', 'main/modules/sync/utils.ts']) {
    const source = fs.readFileSync(join(root, file), 'utf8').replaceAll('\r\n', '\n')
    assert.equal(adaptSyncSource(file, source), source)
  }
  assert.throws(() => adaptSyncSource('main/modules/sync/client/client.ts', 'upstream changed'), /shape changed/)
})

test('concurrent snapshot pruning retains protected device snapshots and flush drains maintenance', async () => {
  const fs = require('node:fs')
  const context = require('../../src-ztools/preload/runtime/context.cjs')
  const storage = require('../../src-ztools/preload/runtime/sync/storage.cjs')
  context.lx = { appSetting: { 'sync.server.maxSsnapshotNum': 1 } }
  const { SnapshotDataManage } = require('../../src-ztools/preload/upstream/main/modules/sync/server/modules/list/snapshotDataManage.cjs')
  const manager = new SnapshotDataManage({ userDir: mkdtempSync(join(tmpdir(), 'lx-sync-prune-')), userName: 'default' })
  manager.snapshotInfo = { latest: 'a', time: 0, list: ['a', 'b', 'protected'], clients: { device: { snapshotKey: 'protected', lastSyncDate: 0 } } }
  manager.clientSnapshotKeys = ['protected']
  for (const name of ['a', 'b', 'protected']) fs.writeFileSync(join(manager.snapshotDir, 'snapshot_' + name), '{}')
  try {
    await Promise.all([manager.clearOldSnapshot(), manager.clearOldSnapshot()])
    await storage.flush()
    assert.deepEqual(manager.snapshotInfo.list, ['a', 'protected'])
    assert.equal(fs.existsSync(join(manager.snapshotDir, 'snapshot_protected')), true)
  } finally { context.lx = null }
})

test('concurrent snapshot creation records a previous snapshot only once', async () => {
  const context = require('../../src-ztools/preload/runtime/context.cjs')
  const storage = require('../../src-ztools/preload/runtime/sync/storage.cjs')
  const bridge = createBridge()
  const directory = mkdtempSync(join(tmpdir(), 'lx-sync-create-'))
  const runtime = initializeRuntime({ bridge, directory })
  const { ListManage } = require('../../src-ztools/preload/upstream/main/modules/sync/server/modules/list/manage.cjs')
  context.lx.appSetting['sync.server.maxSsnapshotNum'] = 100
  const manager = new ListManage({ userDir: directory, userName: 'default' })
  manager.snapshotDataManage.snapshotInfo.latest = 'previous'
  try {
    const keys = await Promise.all([manager.createSnapshot(), manager.createSnapshot()])
    await storage.flush()
    assert.equal(keys[0], keys[1])
    assert.deepEqual(manager.snapshotDataManage.snapshotInfo.list, ['previous'])
  } finally { await runtime.dispose() }
})

test('terminating the production runtime process releases its sync listener', { timeout: 10000 }, async t => {
  const { spawn } = require('node:child_process')
  const reservation = http.createServer()
  reservation.listen(0, '0.0.0.0'); await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const directory = mkdtempSync(join(tmpdir(), 'lx-sync-kill-'))
  const source = `
    const {createBridge}=require('./src-ztools/preload/runtime/bridge.cjs');
    const {initializeRuntime}=require('./src-ztools/preload/runtime/index.cjs');
    const runtime=initializeRuntime({bridge:createBridge(),directory:${JSON.stringify(directory)}});
    runtime.sync.start({mode:'server',port:${port}}).then(()=>process.send({ready:true}),error=>process.send({error:error.message}));
  `
  const child = spawn(process.execPath, ['-e', source], { cwd: join(__dirname, '../..'), windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  t.after(async () => { if (child.exitCode == null && child.signalCode == null) { child.kill(); await once(child, 'exit') } })
  const [message] = await once(child, 'message')
  assert.equal(message.ready, true, message.error)
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/hello`)).text(), 'Hello~::^-^::~v4~')
  const exited = once(child, 'exit'); child.kill(); await exited
  reservation.listen(port, '0.0.0.0'); await once(reservation, 'listening')
  await new Promise(resolve => reservation.close(resolve))
})
