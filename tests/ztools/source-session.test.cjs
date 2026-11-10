const { test } = require('node:test')
const assert = require('node:assert/strict')
const { SourceSession } = require('../../src-ztools/preload/runtime/source/session.cjs')

function readySession() {
  const fatal = [], cancelled = []
  const session = new SourceSession({ info: {}, network: { cancel: id => cancelled.push(id) }, onFatal: error => fatal.push(error.message) })
  session.sources = { kw: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } }
  session.origin = 'http://127.0.0.1'
  session.server = { token: 'test', close: async () => {} }
  session.frame = { contentWindow: { postMessage() {} }, remove() {} }
  return { session, fatal, cancelled }
}
const input = { requestKey: 'pending', data: { source: 'kw', action: 'musicUrl', info: { type: '128k', musicInfo: { id: 'test' } } } }

test('fatal Worker errors close the source and cancel its HTTP/pending work', async t => {
  const { session, fatal, cancelled } = readySession()
  t.after(() => session.close())
  session.http.add('test:http')
  const pending = session.request(input)
  const rejected = assert.rejects(pending, /崩溃|取消|切换/)
  session.handle({ type: 'error', error: '音源崩溃' })
  assert.equal(session.closed, true)
  await rejected
  assert.deepEqual(fatal, ['音源崩溃'])
  assert.deepEqual(cancelled, ['test:http'])
})

test('an unresponsive source is terminated at the request deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { session, fatal } = readySession()
  t.after(() => session.close())
  const rejected = assert.rejects(session.request(input), /超时/)
  t.mock.timers.tick(30001)
  await rejected
  assert.equal(session.closed, true)
  assert.match(fatal[0], /超时/)
})
