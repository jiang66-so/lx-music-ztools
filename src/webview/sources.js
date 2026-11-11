import protocol from '../../src-ztools/preload/runtime/source/protocol.cjs'
import { Buffer } from 'buffer'
import workerBundle from '@webview/source-worker'
const infoKeys = { name: 24, description: 36, version: 36, author: 56, homepage: 1024 }
export function createSources({ store, network, statusChanged, alert }) {
  let session, selected, activation, generation = 0, status = { status: false, message: '' }
  const list = () => store.read().sources.map(({ script, hash, ...info }) => info)
  const publish = next => { status = next; statusChanged(structuredClone(next)) }
  const close = (reason = '音源已切换') => { session?.close(reason); session = null }
  const makeSession = (info, workerText) => {
    const { script: rawScript, ...publicInfo } = info
    const token = crypto.randomUUID(), pending = new Map(), http = new Set()
    const frame = document.createElement('iframe')
    frame.hidden = true; frame.sandbox = 'allow-scripts'
    let resolveInit, rejectInit, closed = false, sources
    const ready = new Promise((resolve, reject) => { resolveInit = resolve; rejectInit = reject })
    const send = data => { if (!closed) frame.contentWindow?.postMessage({ ...data, token }, '*') }
    const api = { ready, close(reason) {
      if (closed) return
      send({ type: 'dispose' }); closed = true; clearTimeout(timer)
      window.removeEventListener('message', listener); frame.remove(); rejectInit(new Error(reason))
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(reason)) }
      pending.clear(); for (const id of http) network.cancel(id); http.clear()
    }, request(input) {
      if (closed || !sources) return Promise.reject(new Error('音源未就绪'))
      try { protocol.validateRequest(sources, input.data) } catch (error) { return Promise.reject(error) }
      if (typeof input.requestKey !== 'string' || !input.requestKey || pending.has(input.requestKey) || pending.size >= 64) return Promise.reject(new Error('音源请求 ID 无效或请求过多'))
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(input.requestKey); reject(new Error('音源请求超时')); api.close('音源请求超时，请重新启用'); if (session === api) { activation = null; publish({ status: false, message: '音源请求超时，请重新启用', apiInfo: publicInfo }) } }, 30000)
        pending.set(input.requestKey, { input, timer, resolve, reject }); send({ type: 'request', input })
      })
    }, cancel(key) { const item = pending.get(key); if (item) { clearTimeout(item.timer); item.reject(new Error('取消音源请求')); pending.delete(key) } } }
    const timer = setTimeout(() => { rejectInit(new Error('音源初始化超时')); api.close('音源初始化超时') }, 8000)
    const listener = async event => {
      if (closed || event.source !== frame.contentWindow || event.data?.token !== token) return
      const message = event.data
      try {
        if (message.type === 'ready') send({ type: 'boot', bundle: workerText, info })
        else if (message.type === 'inited') { sources = protocol.normalizeSources(message.sources); clearTimeout(timer); resolveInit(sources) }
        else if (message.type === 'error' || message.type === 'init-error') { const error = new Error(String(message.error).slice(0, 1024)); rejectInit(error); api.close(error.message); if (session === api) { activation = null; publish({ status: false, message: error.message, apiInfo: publicInfo }) } }
        else if (message.type === 'response') {
          const item = pending.get(message.requestKey)
          if (!item) return
          pending.delete(message.requestKey); clearTimeout(item.timer)
          if (message.error) item.reject(new Error(String(message.error).slice(0, 1024)))
          else { try { item.resolve(protocol.normalizeResult(item.input.data, item.input.data.action === 'musicUrl' ? message.result?.data?.url : message.result?.data)) } catch (error) { item.reject(error) } }
        } else if (message.type === 'http-cancel') network.cancel(token + ':' + message.id)
        else if (message.type === 'http') {
          if (typeof message.id !== 'string' || message.id.length > 100) return
          const id = token + ':' + message.id
          if (http.size >= 32 || http.has(id)) { send({ type: 'http-response', id: message.id, error: '音源 HTTP 请求过多' }); return }
          http.add(id)
          try {
            const options = Object.fromEntries(['method', 'headers', 'body', 'form', 'formData', 'timeout'].filter(key => Object.hasOwn(message.options || {}, key)).map(key => [key, message.options[key]]))
            for (const path of message.bufferPaths || []) {
              if (!Array.isArray(path) || !['body', 'form', 'formData'].includes(path[0]) || path.some(key => typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))) continue
              let owner = options
              for (const key of path.slice(0, -1)) owner = owner && Object.hasOwn(owner, key) ? owner[key] : null
              const key = path.at(-1)
              if (owner && Object.hasOwn(owner, key) && ArrayBuffer.isView(owner[key])) owner[key] = Buffer.from(owner[key])
            }
            const response = await network.requestSource({ ...options, id, url: message.url }).result
            send({ type: 'http-response', id: message.id, response })
          } catch (error) { send({ type: 'http-response', id: message.id, error: error.message }) }
          finally { http.delete(id) }
        } else if (message.type === 'updateAlert' && store.read().sources.find(item => item.id === selected)?.allowShowUpdateAlert) alert({ name: info.name, ...message.data })
      } catch (error) { rejectInit(error); api.close(error.message) }
    }
    window.addEventListener('message', listener)
    // Opaque-origin sandbox + inherited CSP. The source never shares app storage or raw network.
    frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; worker-src blob:; child-src blob:"><script>const token=${JSON.stringify(token)};let worker;addEventListener('message',e=>{if(e.source!==parent||e.data.token!==token)return;const d=e.data;if(d.type==='boot'&&!worker){const url=URL.createObjectURL(new Blob([d.bundle],{type:'text/javascript'}));worker=new Worker(url);URL.revokeObjectURL(url);worker.onmessage=e=>parent.postMessage({...e.data,token},'*');worker.onerror=e=>parent.postMessage({type:'error',error:e.message,token},'*');worker.postMessage({type:'init',info:d.info})}else if(d.type==='dispose')worker?.terminate();else worker?.postMessage(d)});parent.postMessage({type:'ready',token},'*')<\/script>`
    document.body.append(frame)
    return api
  }
  return {
    list, getStatus: () => structuredClone(status),
    async importScript(script) {
      if (typeof script !== 'string' || script.length > 9000000) throw new Error('音源脚本大小无效')
      const header = /^\/\*[\s\S]+?\*\//.exec(script)
      if (!header) throw new Error('无效的自定义源文件')
      const info = { name: 'LX 自定义音源', description: '', version: '', author: '', homepage: '' }
      for (const line of header[0].split(/\r?\n/)) { const match = /^\s?\*\s?@(\w+)\s(.+)$/.exec(line); if (match && Object.hasOwn(infoKeys, match[1])) info[match[1]] = match[2].trim().slice(0, infoKeys[match[1]]) }
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script)))].map(byte => byte.toString(16).padStart(2, '0')).join('')
      const apiInfo = { ...info, id: 'user_api_' + crypto.randomUUID(), allowShowUpdateAlert: true }
      await store.update(state => { if (state.sources.some(item => item.hash === hash)) throw new Error('脚本内容与已有音源相同'); state.sources.push({ ...apiInfo, script, hash }) })
      return { apiInfo, apiList: list() }
    },
    activate(id) {
      if (selected === id && activation) return activation
      selected = id; const current = ++generation; close()
      activation = (async () => {
        const entry = store.read().sources.find(item => item.id === id)
        if (!entry) { publish({ status: false, message: '' }); return }
        const { script, hash, ...apiInfo } = entry
        try {
          if (current !== generation) throw new Error('source changed')
          const active = session = makeSession({ ...apiInfo, script }, workerBundle)
          const sources = await active.ready
          if (current !== generation) throw new Error('source changed')
          publish({ status: true, message: '', apiInfo: { ...apiInfo, sources } })
        } catch (error) { if (current === generation) { activation = null; publish({ status: false, message: error.message, apiInfo }) } throw error }
      })()
      return activation
    },
    request: input => session ? session.request(input) : Promise.reject(new Error('没有可用音源')),
    cancel: key => session?.cancel(key),
    async remove(ids) { await store.update(state => { state.sources = state.sources.filter(item => !ids.includes(item.id)) }); if (ids.includes(selected)) { ++generation; close(); activation = null; selected = null; publish({ status: false, message: '' }) } return list() },
    async setAllowUpdate(id, enable) { await store.update(state => { const item = state.sources.find(item => item.id === id); if (item) item.allowShowUpdateAlert = Boolean(enable) }) },
    dispose() { ++generation; close('页面已关闭') },
  }
}
