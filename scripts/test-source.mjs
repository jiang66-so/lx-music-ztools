import { startHost } from './host-fixture.mjs'
import http from 'node:http'
import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
mkdirSync('artifacts/source', { recursive: true })
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname !== '/resolve') { res.writeHead(404); res.end(); return }
  assert.equal(req.headers['x-lx-hash'], '900150983cd24fb0d6963f7d28e17f72')
  const send = () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ url: base + '/audio.wav?id=' + url.searchParams.get('id') })) }
  if (url.searchParams.get('id') === 'slow') setTimeout(send, 1000)
  else send()
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
let host
const record = { evidence: 'Actual isolated ZTools; controlled local source and server only' }
try {
  host = await startHost()
  const invoke = (channel, params) => host.evaluate(`lxHost.invoke(${JSON.stringify(channel)},${JSON.stringify(params)})`)
  const script = readFileSync('tests/ztools/fixtures/source-api-v2.js', 'utf8').replaceAll('__BASE_URL__', base)
  const imported = await invoke('winMain_import_user_api', script)
  assert.equal(imported.apiList.length, 1)
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  const status = await invoke('winMain_get_user_api_status')
  assert.equal(status.status, true)
  assert.deepEqual(status.apiInfo.sources.kw.qualitys, ['128k', '320k'])
  const input = (id, key = 'one') => ({ requestKey: key, data: { source: 'kw', action: 'musicUrl', info: { type: '128k', musicInfo: { id } } } })
  const response = await invoke('winMain_request_user_api', input('ok'))
  assert.equal(response.data.url, base + '/audio.wav?id=ok')
  await assert.rejects(invoke('winMain_request_user_api', { ...input('bad'), data: { ...input('bad').data, info: { type: 'unknown', musicInfo: { id: 'bad' } } } }), /音质|quality/)
  const slow = invoke('winMain_request_user_api', input('slow', 'slow'))
  const cancelled = assert.rejects(slow, /取消|切换|cancel|changed/i)
  await new Promise(resolve => setTimeout(resolve, 100))
  await invoke('winMain_set_user_api', 'temp')
  await cancelled
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  assert.equal((await invoke('winMain_request_user_api', input('again', 'again'))).data.url, base + '/audio.wav?id=again')
  await assert.rejects(invoke('winMain_import_user_api', 'not a valid script'), /无效|invalid/)
  const busy = await invoke('winMain_import_user_api', '/**\n * @name Initialization deadline fixture\n */\nwhile(true){}')
  await assert.rejects(invoke('winMain_set_user_api', busy.apiInfo.id), /超时/)
  assert.equal(await host.evaluate('services.diagnose().runtime.source.sessions'), 0)
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  assert.equal((await invoke('winMain_request_user_api', input('after-init-hang', 'after-init-hang'))).data.url, base + '/audio.wav?id=after-init-hang')
  const hung = await invoke('winMain_import_user_api', '/**\n * @name Request deadline fixture\n */\nlx.on(lx.EVENT_NAMES.request,()=>{while(true){}});lx.send(lx.EVENT_NAMES.inited,{sources:{kw:{type:"music",actions:["musicUrl"],qualitys:["128k"]}}});')
  await invoke('winMain_set_user_api', hung.apiInfo.id)
  await assert.rejects(invoke('winMain_request_user_api', input('hang', 'hang')), /超时/)
  assert.equal(await host.evaluate('services.diagnose().runtime.source.sessions'), 0)
  assert.equal((await invoke('winMain_get_user_api_status')).status, false)
  await invoke('winMain_set_user_api', imported.apiInfo.id)
  assert.equal((await invoke('winMain_request_user_api', input('after-request-hang', 'after-request-hang'))).data.url, base + '/audio.wav?id=after-request-hang')
  record.deadlines = 'Actual busy Workers terminated after init/request deadlines; next source succeeds; UI/host remain responsive'
  record.status = 'PASS'; record.source = { status, response }; record.data = host.data
  console.log('PASS source import/init/crypto/HTTP/quality/switch; busy init and request Workers terminate with recovery')
} catch (error) { record.status = 'FAIL'; record.error = String(error.stack || error); record.logs = await host?.logs(); process.exitCode = 1 }
finally { writeFileSync('artifacts/source/report.json', JSON.stringify(record, null, 2)); await host?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
