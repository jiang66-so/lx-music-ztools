import { Buffer } from 'buffer'
/** Direct Fetch only. Never silently insert a proxy or disable browser CORS. */
export function createNetwork() {
  const pending = new Map()
  const request = input => {
    const id = input.id || crypto.randomUUID()
    if (pending.has(id) || pending.size >= 64) throw new Error('HTTP 请求过多或 ID 重复')
    const url = new URL(input.url)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许 HTTP(S) 请求')
    const controller = new AbortController()
    pending.set(id, controller)
    const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(input.timeout) || 30000, 100), 60000))
    const result = (async () => {
      try {
        const headers = new Headers(input.headers || {})
        let body = input.body
        if (input.form) body = new URLSearchParams(input.form)
        else if (input.formData) { body = new FormData(); for (const [key, value] of Object.entries(input.formData)) body.append(key, value) }
        else if (body && typeof body === 'object' && !ArrayBuffer.isView(body) && !(body instanceof ArrayBuffer)) { body = JSON.stringify(body); if (!headers.has('content-type')) headers.set('content-type', 'application/json') }
        const method = (input.method || 'get').toUpperCase()
        const response = await fetch(url, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body, signal: controller.signal, credentials: 'omit' })
        const raw = new Uint8Array(await response.arrayBuffer())
        let parsed = new TextDecoder(input.encoding || 'utf-8').decode(raw)
        if (input.format !== 'text' && input.format !== 'script') { try { parsed = JSON.parse(parsed) } catch {} }
        if (input.binary || input.isBuffer || input.format === 'buffer') parsed = Buffer.from(raw)
        return { statusCode: response.status, statusMessage: response.statusText, headers: Object.fromEntries(response.headers), raw, bytes: raw.byteLength, body: parsed }
      } catch (error) {
        if (controller.signal.aborted) throw new Error('请求已取消或超时')
        throw new Error('WebView 请求失败，可能受 CORS、混合内容或请求头限制：' + error.message)
      } finally { clearTimeout(timer); pending.delete(id) }
    })()
    return { id, result, cancel: () => controller.abort() }
  }
  return { request, requestSource: request, cancel: id => pending.get(id)?.abort(), dispose() { for (const controller of pending.values()) controller.abort() }, inspect: () => ({ pending: pending.size }) }
}
