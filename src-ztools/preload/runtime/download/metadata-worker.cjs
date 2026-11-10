const fs = require('node:fs')
const { pipeline } = require('node:stream/promises')
const { workerData, parentPort } = require('node:worker_threads')
async function write() {
  const { filePath, ext, meta, cover } = workerData
  const { parseFile } = await import('music-metadata')
  const before = await parseFile(filePath)
  if (ext === '.mp3') {
    const NodeID3 = require('node-id3')
    const tags = { title: meta.title, artist: meta.artist, album: meta.album, unsynchronisedLyrics: { language: 'zho', text: meta.lyrics } }
    if (cover) tags.image = { mime: cover.mime, type: { id: 3, name: 'front cover' }, description: '', imageBuffer: Buffer.from(cover.data) }
    // Running in a Node worker keeps the library's full-file parsing off the host UI thread.
    const result = NodeID3.update(tags, filePath)
    if (result !== true) throw result instanceof Error ? result : new Error('MP3 标签写入失败')
  } else {
    const FlacProcessor = require('../../upstream/common/utils/musicMeta/flac-metadata/index.cjs')
    const processor = new FlacProcessor()
    const data = { vorbis: { vendor: 'LX Music ZTools', comments: Object.entries(meta).map(([key, value]) => `${key.toUpperCase()}=${value}`) } }
    if (cover) data.picture = { pictureType: 3, mimeType: cover.mime, description: '', width: cover.width, height: cover.height, bitsPerPixel: cover.mime === 'image/png' ? 32 : 24, colors: 0, pictureData: Buffer.from(cover.data) }
    processor.writeMeta(data)
    const output = filePath + '.flac-writing'
    try {
      await pipeline(fs.createReadStream(filePath), processor, fs.createWriteStream(output, { flags: 'wx' }))
      await fs.promises.rename(output, filePath)
    } finally { await fs.promises.rm(output, { force: true }) }
  }
  const after = await parseFile(filePath)
  if (after.common.title !== meta.title || after.common.album !== meta.album || !after.format.duration || before.format.duration && Math.abs(after.format.duration - before.format.duration) > 0.05) throw new Error('标签回读或音频时长验证失败')
  const handle = await fs.promises.open(filePath, 'r+')
  try { await handle.sync() } finally { await handle.close() }
  return { duration: after.format.duration, title: after.common.title, album: after.common.album }
}
write().then(metadata => parentPort.postMessage({ ok: true, metadata }), error => parentPort.postMessage({ ok: false, error: error.message }))
