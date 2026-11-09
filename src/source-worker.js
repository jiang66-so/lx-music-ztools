import crypto from 'crypto-browserify'
import { Buffer } from 'buffer'
import { inflate, deflate } from 'pako'

// This bundle runs in an opaque browser Worker; Node services remain outside it.
const tools = {
  crypto: {
    md5: value => crypto.createHash('md5').update(value).digest('hex'),
    aesEncrypt(buffer, mode, key, iv) {
      const cipher = crypto.createCipheriv(mode, key, iv)
      return Buffer.concat([cipher.update(buffer), cipher.final()])
    },
    rsaEncrypt(buffer, key) {
      buffer = Buffer.concat([Buffer.alloc(128 - buffer.length), buffer])
      return crypto.publicEncrypt({ key, padding: 3 }, buffer)
    },
    randomBytes: size => crypto.randomBytes(size),
  },
  buffer: { from: (...args) => Buffer.from(...args), bufToString: (buf, format) => Buffer.from(buf, 'binary').toString(format) },
  zlib: { inflate: async buf => Buffer.from(inflate(buf)), deflate: async buf => Buffer.from(deflate(buf)) },
}
// Capture the transport before script evaluation so replacement globals cannot hijack replies.
const reply = globalThis.postMessage.bind(globalThis)
globalThis.onmessage = async ({ data }) => {
  if (data.type === 'busy') { while (true) { /* Test external termination of uncooperative scripts. */ } }
  if (data.type !== 'probe') return
  try {
    const result = { node: typeof globalThis.require, ztools: typeof globalThis.ztools,
      syncMd5: tools.crypto.md5('abc'), origin: globalThis.origin,
      hostFileReadable: await fetch('file:///C:/Windows/win.ini').then(() => true, () => false),
      networkReadable: await fetch(data.url).then(() => true, () => false),
      aes: tools.buffer.bufToString(tools.crypto.aesEncrypt(Buffer.from('test'), 'aes-128-cbc', Buffer.alloc(16), Buffer.alloc(16)), 'hex'),
      compressed: tools.buffer.bufToString(await tools.zlib.inflate(await tools.zlib.deflate(Buffer.from('中文'))), 'utf8'),
      rsa: tools.buffer.bufToString(tools.crypto.rsaEncrypt(Buffer.from('abc'), data.publicKey), 'hex'),
    }
    reply({ type: 'probe-result', result })
  } catch (error) { reply({ type: 'error', error: error.message }) }
}
