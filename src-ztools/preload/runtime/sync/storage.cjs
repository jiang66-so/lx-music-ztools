const fs = require('node:fs')
const timers = new Map()
const writes = new Set()
const errors = []
const ownerQueues = new WeakMap()
const latestWrites = new Map()
const failedWrites = new Map()
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
function performWrite(record) {
  const { args, callback, file } = record
  let done
  const pending = new Promise(resolve => { done = resolve })
  writes.add(pending)
  fs.writeFile(...args, error => {
    if (latestWrites.get(file) === record) {
      if (error) { record.error = error; failedWrites.set(file, record) }
      else failedWrites.delete(file)
    }
    try { callback(error) } finally { writes.delete(pending); done() }
  })
}
function writeFile(...args) {
  const callback = args.pop()
  const record = { args, callback, file: String(args[0]), error: null }
  latestWrites.set(record.file, record)
  performWrite(record)
}
async function flush() {
  // Retry only failures from an earlier attempt. A newly failed write is kept
  // for the next explicit flush, so an unavailable disk cannot spin forever.
  for (const record of [...failedWrites.values()]) performWrite(record)
  while (timers.size || writes.size) {
    for (const run of [...timers.keys()]) run()
    await Promise.allSettled([...writes])
  }
  const failures = [...errors.splice(0), ...[...failedWrites.values()].map(record => record.error)]
  if (failures.length) throw new AggregateError(failures, '同步快照或认证数据保存失败')
}
module.exports = { throttle, writeFile, serial, flush }
