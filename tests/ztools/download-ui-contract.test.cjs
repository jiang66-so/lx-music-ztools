const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const adapt = require('../../build-config/ztools/download-loader.cjs')
const { DOWNLOAD_STATUS: S } = require('../../src-ztools/preload/upstream/common/constants.cjs')

function load() {
  const list = [], callbacks = new Map(), removed = [], saved = [], finalized = []
  let finishMeta
  const meta = new Promise(resolve => { finishMeta = resolve })
  const setting = { 'download.maxDownloadNum': 2, 'download.isEmbedPic': false, 'download.isEmbedLyric': false, 'download.isDownloadLrc': false }
  const ipc = { downloadTasksGet: async () => [], downloadTasksCreate: async () => {}, downloadTasksRemove: async () => {}, downloadTasksUpdate: async items => saved.push(...items) }
  const imports = {
    '@renderer/utils/ipc': ipc, './state': { downloadList: list },
    '@common/utils/vueTools': { toRaw: x => x, markRaw: x => x },
    '@renderer/core/music/online': {}, '../setting': { appSetting: setting },
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
    window: { lx: { worker: { download: worker } }, app_event: { downloadListUpdate() {} }, i18n: { t: key => key } }, setTimeout: () => 1, clearTimeout() {}, console })
  return { actions: module.exports, list, callbacks, removed, saved, finalized, finishMeta, worker }
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
