const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const adapt = require('../../build-config/ztools/download-loader.cjs')
const { DOWNLOAD_STATUS: S } = require('../../src-ztools/preload/upstream/common/constants.cjs')

function load() {
  const list = [], callbacks = new Map(), removed = [], saved = [], finalized = [], timers = []
  let finishMeta
  const meta = new Promise(resolve => { finishMeta = resolve })
  const setting = { 'download.maxDownloadNum': 2, 'download.isEmbedPic': false, 'download.isEmbedLyric': false, 'download.isDownloadLrc': false }
  const online = {}
  const ipc = { downloadTasksGet: async () => [], downloadTasksCreate: async () => {}, downloadTasksRemove: async () => {}, downloadTasksUpdate: async items => saved.push(...items) }
  const imports = {
    '@renderer/utils/ipc': ipc, './state': { downloadList: list },
    '@common/utils/vueTools': { toRaw: x => x, markRaw: x => x },
    '@renderer/core/music/online': online, '../setting': { appSetting: setting },
    '..': { qualityList: { value: {} } }, '../index': { proxy: {} },
    '@renderer/worker/utils': { proxyCallback: x => x },
    '@renderer/utils': { arrPush: (a, b) => a.push(...b), arrUnshift: (a, b) => a.unshift(...b), joinPath: (...parts) => parts.join('/') },
    '@common/constants': { DOWNLOAD_STATUS: S }, './utils': { buildSavePath: () => '/download' },
  }
  const worker = { startTask: async (info, _path, _skip, callback) => callbacks.set(info.id, callback),
    writeMeta: () => meta, saveLrc: async () => {}, finalizeTask: async (...args) => finalized.push(args),
    removeTask: async id => removed.push(id), pauseTask: async () => {} }
  const module = { exports: {} }
  const source = adapt(fs.readFileSync('vendor/lx/src/renderer/store/download/action.ts', 'utf8'))
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { exports: module.exports, module, require: name => { if (!imports[name]) throw new Error('Unexpected import: ' + name); return imports[name] },
    window: { lx: { worker: { download: worker } }, app_event: { downloadListUpdate() {} }, i18n: { t: key => key } }, setTimeout: callback => timers.push(callback), clearTimeout() {}, console })
  return { actions: module.exports, list, callbacks, removed, saved, finalized, finishMeta, worker, ipc, setting, online, flushTimers() { for (const callback of timers.splice(0)) callback() } }
}
const task = id => ({ id, status: S.PAUSE, isComplate: false, progress: 0, metadata: { url: 'http://test/audio', quality: '128k', fileName: id + '.mp3', filePath: '/download/' + id + '.mp3', musicInfo: { name: id, singer: 'artist', meta: { albumName: 'album' } } } })

test('original download UI waits for metadata and backend ACK before persisting completed', async () => {
  const x = load(), info = task('one'); x.list.push(info)
  await x.actions.startDownloadTasks([info])
  const finishing = x.callbacks.get(info.id)({ action: 'complete' })
  assert.notEqual(info.status, S.COMPLETED)
  assert.equal(x.finalized.length, 0)
  x.finishMeta(); await finishing
  assert.equal(info.status, S.COMPLETED)
  assert.equal(info.isComplate, true)
  assert.deepEqual(x.finalized, [['one']])
  assert.equal(x.saved.at(-1).status, S.COMPLETED)
})

test('removing one original UI task leaves another running task alone', async () => {
  const x = load(), a = task('a'), b = task('b'); x.list.push(a, b)
  await x.actions.startDownloadTasks([a, b])
  await x.actions.removeDownloadTasks(['a'])
  assert.deepEqual(x.removed, ['a'])
  assert.deepEqual(x.list.map(x => x.id), ['b'])
})
test('pausing original UI waits for backend before allowing resume and ignores late completion', async () => {
  const x = load(), info = task('pause'); x.list.push(info)
  await x.actions.startDownloadTasks([info])
  const finishing = x.callbacks.get(info.id)({ action: 'complete' })
  let release, settled = false
  x.worker.pauseTask = () => new Promise(resolve => { release = resolve })
  const pausing = x.actions.pauseDownloadTasks([info]).then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  release(); await pausing
  x.finishMeta(); await finishing
  assert.equal(info.status, S.PAUSE)
  assert.equal(info.isComplate, false)
  assert.equal(x.finalized.length, 0)
})
test('metadata failure leaves original UI incomplete and retains backend finalization record', async () => {
  const x = load(), info = task('bad'); x.list.push(info)
  x.worker.writeMeta = () => Promise.reject(new Error('tag failure'))
  await x.actions.startDownloadTasks([info])
  await x.callbacks.get(info.id)({ action: 'complete' })
  assert.equal(info.status, S.ERROR)
  assert.equal(info.isComplate, false)
  assert.deepEqual(x.finalized, [['bad', 'tag failure']])
  assert.equal(x.removed.length, 0)
})
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function until(predicate) { const deadline = Date.now() + 5000; while (!predicate()) { assert.ok(Date.now() < deadline, 'async stage did not start'); await new Promise(setImmediate) } }
test('pause waits only for an already started ACK commit and rejects its stale completion before restarting the same id', async () => {
  const x = load(), info = task('ack-race'); x.list.push(info); x.finishMeta()
  const ack = deferred(); let ackStarted = false
  x.worker.finalizeTask = async () => { ackStarted = true; await ack.promise }
  await x.actions.startDownloadTasks([info])
  const oldCallback = x.callbacks.get(info.id), finishing = oldCallback({ action: 'complete' })
  await until(() => ackStarted)
  let paused = false
  const pausing = x.actions.pauseDownloadTasks([info]).then(() => { paused = true })
  await new Promise(setImmediate)
  assert.equal(paused, false)
  ack.resolve(); await Promise.all([finishing, pausing])
  assert.equal(info.status, S.PAUSE); assert.equal(info.isComplate, false)
  assert.equal(x.saved.at(-1).status, S.PAUSE); assert.equal(x.removed.length, 0)
  await x.actions.startDownloadTasks([info])
  await oldCallback({ action: 'complete' })
  assert.equal(info.status, S.RUN); assert.equal(x.removed.length, 0)
})
test('pause serializes an in-flight completed SQL write and persists pause after it before returning', async () => {
  const x = load(), info = task('db-race'); x.list.push(info); x.finishMeta()
  const commit = deferred(); let writingCompleted = false
  const write = x.ipc.downloadTasksUpdate
  x.ipc.downloadTasksUpdate = async items => { if (items.some(item => item.status === S.COMPLETED)) { writingCompleted = true; await commit.promise } return write(items) }
  await x.actions.startDownloadTasks([info])
  const finishing = x.callbacks.get(info.id)({ action: 'complete' })
  await until(() => writingCompleted)
  let paused = false
  const pausing = x.actions.pauseDownloadTasks([info]).then(() => { paused = true })
  await new Promise(setImmediate); assert.equal(paused, false)
  commit.resolve(); await Promise.all([finishing, pausing])
  assert.equal(info.status, S.PAUSE); assert.equal(info.isComplate, false)
  assert.equal(x.saved.at(-1).status, S.PAUSE); assert.equal(x.removed.length, 0)
})
test('remove waits for an in-flight completed SQL write and its deletion is the final durable operation', async () => {
  const x = load(), info = task('db-remove-race'); x.list.push(info); x.finishMeta()
  const commit = deferred(), order = []; let writingCompleted = false
  const write = x.ipc.downloadTasksUpdate
  x.ipc.downloadTasksUpdate = async items => { if (items.some(item => item.status === S.COMPLETED)) { writingCompleted = true; await commit.promise; order.push('completed SQL') } return write(items) }
  x.ipc.downloadTasksRemove = async () => { order.push('remove SQL') }
  await x.actions.startDownloadTasks([info])
  const finishing = x.callbacks.get(info.id)({ action: 'complete' })
  await until(() => writingCompleted)
  let removed = false
  const removing = x.actions.removeDownloadTasks([info.id]).then(() => { removed = true })
  await new Promise(setImmediate); assert.equal(removed, false)
  commit.resolve(); await Promise.all([finishing, removing])
  assert.deepEqual(order, ['completed SQL', 'remove SQL']); assert.equal(x.list.length, 0)
  assert.deepEqual(x.removed, [info.id])
})
test('pause also drains an issued throttled SQL update and clears pending stale timer snapshots', async () => {
  const x = load(), info = task('throttled-race'); x.list.push(info)
  const commit = deferred(); let writingRunning = false
  const write = x.ipc.downloadTasksUpdate
  x.ipc.downloadTasksUpdate = async items => { if (items.some(item => item.status === S.RUN)) { writingRunning = true; await commit.promise } return write(items) }
  await x.actions.startDownloadTasks([info]); x.flushTimers()
  await until(() => writingRunning)
  let paused = false
  const pausing = x.actions.pauseDownloadTasks([info]).then(() => { paused = true })
  await new Promise(setImmediate); assert.equal(paused, false)
  commit.resolve(); await pausing
  x.flushTimers(); await new Promise(setImmediate)
  assert.equal(info.status, S.PAUSE); assert.equal(x.saved.at(-1).status, S.PAUSE)
})
test('pausing a list invalidates every selected task before awaiting one task commit', async () => {
  const x = load(), a = task('all-a'), b = task('all-b'); x.list.push(a, b); x.finishMeta()
  const ack = deferred(), stopped = []; let ackStarted = false
  x.worker.finalizeTask = async id => { if (id === a.id) { ackStarted = true; await ack.promise } }
  x.worker.pauseTask = async id => { stopped.push(id) }
  await x.actions.startDownloadTasks([a, b])
  const finishingA = x.callbacks.get(a.id)({ action: 'complete' })
  await until(() => ackStarted)
  const pausing = x.actions.pauseDownloadTasks([a, b])
  await x.callbacks.get(b.id)({ action: 'complete' })
  assert.ok(stopped.includes(b.id)); assert.notEqual(b.status, S.COMPLETED)
  ack.resolve(); await Promise.all([pausing, finishingA])
  assert.equal(a.status, S.PAUSE); assert.equal(b.status, S.PAUSE)
})
for (const resource of ['picture', 'embed-lyric', 'sidecar-lyric']) for (const stop of ['pause', 'remove']) test(`${stop} returns during pending ${resource} and prevents its late file writes after path reuse`, async () => {
  const x = load(), info = task(`${stop}-${resource}`); x.list.push(info)
  const pending = deferred(); let requested = false
  const writes = []
  x.worker.writeMeta = async (...args) => { writes.push(['meta', ...args]) }
  x.worker.saveLrc = async (...args) => { writes.push(['lrc', ...args]) }
  if (resource === 'picture') { x.setting['download.isEmbedPic'] = true; x.online.getPicUrl = () => { requested = true; return pending.promise } }
  else { x.setting[resource === 'embed-lyric' ? 'download.isEmbedLyric' : 'download.isDownloadLrc'] = true; x.online.getLyricInfo = () => { requested = true; return pending.promise } }
  await x.actions.startDownloadTasks([info])
  const finishing = x.callbacks.get(info.id)({ action: 'complete' })
  await until(() => requested)
  const writesBeforeStop = writes.length
  if (stop === 'pause') await x.actions.pauseDownloadTasks([info])
  else await x.actions.removeDownloadTasks([info.id])
  assert.equal(writes.length, writesBeforeStop)
  const replacement = stop === 'pause' ? info : task(info.id)
  if (stop === 'remove') x.list.push(replacement)
  await x.actions.startDownloadTasks([replacement])
  pending.resolve(resource === 'picture' ? 'http://test/cover.png' : { lyric: '[00:01.000]late lyric' })
  await finishing
  assert.equal(writes.length, writesBeforeStop)
  assert.equal(replacement.status, S.RUN); assert.equal(replacement.isComplate, false)
  assert.deepEqual(x.removed, stop === 'remove' ? [info.id] : [])
})
