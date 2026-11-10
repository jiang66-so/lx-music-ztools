const fs = require('node:fs')
const timers = new Map()
const writes = new Set()
const errors = []
function track(promise) {
  writes.add(promise)
  promise.then(() => writes.delete(promise), error => { errors.push(error); writes.delete(promise) })
  return promise
}
function serial(fn) {
  let queue = Promise.resolve()
  return (...args) => {
    const result = queue.then(() => fn(...args))
    queue = result.catch(() => {})
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
function writeFile(...args) {
  const callback = args.pop()
  let done
  const pending = new Promise(resolve => { done = resolve })
  writes.add(pending)
  fs.writeFile(...args, error => {
    if (error) errors.push(error)
    try { callback(error) } finally { writes.delete(pending); done() }
  })
}
async function flush() {
  while (timers.size || writes.size) {
    for (const run of [...timers.keys()]) run()
    await Promise.allSettled([...writes])
  }
  if (errors.length) throw new AggregateError(errors.splice(0), '同步快照或认证数据保存失败')
}
module.exports = { throttle, writeFile, serial, flush }
