const fs = require('node:fs')
const timers = new Map()
const writes = new Set()
const errors = []
const ownerQueues = new WeakMap()
const latestWrites = new Map()
const failedWrites = new Map()
const fileQueues = new Map()
function track(promise) {
  writes.add(promise)
  promise.then(() => writes.delete(promise), error => { errors.push(error); writes.delete(promise) })
  return promise
}
function serial(fn, owner) {
  let queue = Promise.resolve()
  return (...args) => {
    // Resolve lazily: class field initializers run before constructors assign
    // snapshotDataManage. Both entry points use that same manager identity.
    const key = owner?.()
    const previous = key ? ownerQueues.get(key) || Promise.resolve() : queue
    const result = previous.then(() => fn(...args))
    const next = result.catch(() => {})
    if (key) ownerQueues.set(key, next)
    else queue = next
    return track(result)
  }
}
// Original snapshot/auth throttles, with an explicit flush at host shutdown.
function throttle(fn, delay = 100) {
  let timer, args
  const run = () => {
    clearTimeout(timer); timers.delete(run); timer = null
    try { return fn(...args) } catch (error) { errors.push(error) }
  }
  return (...values) => {
    args = values
    if (timer) return
    timers.set(run, true)
    timer = setTimeout(run, delay)
  }
}
function performWrite(record, retry = false) {
  if (record.pending) return record.pending
  const { args, callback, file } = record
  const previous = fileQueues.get(file) || Promise.resolve()
  const pending = previous.then(() => {
    // A retry may have waited behind a newer write. Recheck at the actual I/O
    // boundary, not only when flush captured the failed record.
    if (retry && latestWrites.get(file) !== record) return
    return new Promise(resolve => {
      const finish = error => {
        if (latestWrites.get(file) === record) {
          if (error) { record.error = error; failedWrites.set(file, record) }
          else { failedWrites.delete(file); latestWrites.delete(file) }
        }
        try { callback(error) } catch (error) { errors.push(error) }
        finally { resolve() }
      }
      try { fs.writeFile(...args, finish) } catch (error) { finish(error) }
    })
  })
  record.pending = pending
  fileQueues.set(file, pending)
  writes.add(pending)
  const complete = () => {
    writes.delete(pending); record.pending = null
    if (fileQueues.get(file) === pending) fileQueues.delete(file)
  }
  pending.then(complete, error => { errors.push(error); complete() })
  return pending
}
function writeFile(...args) {
  const callback = args.pop()
  const record = { args, callback, file: String(args[0]), error: null }
  latestWrites.set(record.file, record)
  failedWrites.delete(record.file)
  performWrite(record)
}
async function flush() {
  // Retry only failures from an earlier attempt. A newly failed write is kept
  // for the next explicit flush, so an unavailable disk cannot spin forever.
  for (const [file, record] of [...failedWrites]) {
    if (latestWrites.get(file) !== record) { failedWrites.delete(file); continue }
    performWrite(record, true)
  }
  while (timers.size || writes.size) {
    for (const run of [...timers.keys()]) run()
    await Promise.allSettled([...writes])
  }
  const failures = [...errors.splice(0), ...[...failedWrites.values()].map(record => record.error)]
  if (failures.length) throw new AggregateError(failures, '同步快照或认证数据保存失败')
}
module.exports = { throttle, writeFile, serial, flush }
