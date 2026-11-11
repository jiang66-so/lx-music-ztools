/** One atomic IndexedDB document; acknowledge only after durable commit. */
export async function openStore(name = 'lx-music-webview-v1') {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('state')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('浏览器存储被旧页面占用，请关闭旧页面后重试'))
  })
  const initial = await new Promise((resolve, reject) => {
    const request = db.transaction('state').objectStore('state').get('app')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  let state = initial || { setting: {}, data: {}, sources: [], themes: [], lists: [], music: { default: [], love: [], temp: [] }, cache: {}, dislike: '' }
  let queue = Promise.resolve()
  return {
    read: () => structuredClone(state),
    update(action) {
      const result = queue.then(async () => {
        const next = structuredClone(state)
        const value = await action(next)
        await new Promise((resolve, reject) => {
          const tx = db.transaction('state', 'readwrite')
          tx.objectStore('state').put(next, 'app')
          tx.oncomplete = resolve
          tx.onerror = () => reject(tx.error || new Error('浏览器存储写入失败'))
          tx.onabort = () => reject(tx.error || new Error('浏览器存储提交失败'))
        })
        state = next
        return value
      })
      queue = result.catch(() => {})
      return result
    },
    async close() { await queue; db.close() },
  }
}
