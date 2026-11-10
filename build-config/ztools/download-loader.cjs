// Keep vendor immutable; adapt only the original download finalization/lifecycle boundaries.
function adaptDownloadAction(source) {
  source = source.replace(/\r\n/g, '\n')
  const replace = (before, after) => {
    if (!source.includes(before)) throw new Error('LX download contract changed: ' + before.slice(0, 70))
    source = source.replace(before, after)
  }
  replace('  void Promise.all(tasks).then(([imgUrl, lyrics]) => {', '  return Promise.all(tasks).then(([imgUrl, lyrics]) => {')
  replace('    void window.lx.worker.download.writeMeta(', '    return window.lx.worker.download.writeMeta(')
  replace('  void getLyricInfo({', '  return getLyricInfo({')
  replace('      void window.lx.worker.download.saveLrc(lrcs, info)', '      return window.lx.worker.download.saveLrc(lrcs, info)')
  replace('proxyCallback((event: LX.Download.DownloadTaskActions)', 'proxyCallback(async(event: LX.Download.DownloadTaskActions)')
  replace('const runingTask = new Map<string, LX.Download.ListItem>()', 'const runingTask = new Map<string, LX.Download.ListItem>()\nconst downloadEpochs = new Map<string, number>()')
  replace('const handleStartTask = async(downloadInfo: LX.Download.ListItem) => {', `const handleStartTask = async(downloadInfo: LX.Download.ListItem) => {
  const epoch = downloadEpochs.get(downloadInfo.id)
  const isCurrent = () => downloadEpochs.get(downloadInfo.id) === epoch && downloadList.includes(downloadInfo)`)
  replace('    if (downloadInfo.status != DOWNLOAD_STATUS.RUN) return', '    if (!isCurrent() || downloadInfo.status != DOWNLOAD_STATUS.RUN) return')
  replace('const startTask = async(downloadInfo: LX.Download.ListItem) => {', `const startTask = async(downloadInfo: LX.Download.ListItem) => {
  downloadEpochs.set(downloadInfo.id, (downloadEpochs.get(downloadInfo.id) || 0) + 1)`)
  replace('        void window.lx.worker.download.pauseTask(downloadInfo.id)', `        downloadEpochs.set(downloadInfo.id, (downloadEpochs.get(downloadInfo.id) || 0) + 1)
        await window.lx.worker.download.pauseTask(downloadInfo.id)`)
  const start = source.indexOf("      case 'complete':")
  const end = source.indexOf("      case 'refreshUrl':", start)
  if (start < 0 || end < 0) throw new Error('LX download completion contract changed')
  source = source.slice(0, start) + `      case 'complete':
        if (!isCurrent()) break
        try {
          downloadInfo.progress = 99.99
          setStatusText(downloadInfo, '正在写入标签与歌词')
          await saveMeta(downloadInfo)
          if (!isCurrent()) break
          await downloadLyric(downloadInfo)
          if (!isCurrent()) break
          await window.lx.worker.download.finalizeTask(downloadInfo.id)
          const completed = { ...toRaw(downloadInfo), progress: 100, isComplate: true,
            status: DOWNLOAD_STATUS.COMPLETED, statusText: window.i18n.t('download___status_completed') }
          await downloadTasksUpdate([completed])
          Object.assign(downloadInfo, completed)
          await window.lx.worker.download.removeTask(downloadInfo.id).catch(console.error)
        } catch (error) {
          if (!isCurrent()) break
          await window.lx.worker.download.finalizeTask(downloadInfo.id, String(error.message || error)).catch(console.error)
          downloadInfo.isComplate = false
          setStatus(downloadInfo, DOWNLOAD_STATUS.ERROR, String(error.message || error))
        } finally {
          if (isCurrent()) {
            runingTask.delete(downloadInfo.id)
            void checkStartTask()
          }
        }
        break
` + source.slice(end)
  replace('  await downloadTasksRemove(ids)\n\n  const idsSet', '  const idsSet')
  const filter = source.indexOf('  const newList = downloadList.filter(task => {')
  const splice = source.indexOf('  downloadList.splice', filter)
  if (filter < 0 || splice < 0) throw new Error('LX download remove contract changed')
  source = source.slice(0, filter) + `  for (const id of idsSet) downloadEpochs.set(id, (downloadEpochs.get(id) || 0) + 1)
  await Promise.all([...idsSet].map(id => window.lx.worker.download.removeTask(id)))
  await downloadTasksRemove([...idsSet])
  for (const id of idsSet) runingTask.delete(id)
  const newList = downloadList.filter(task => !idsSet.has(task.id))
` + source.slice(splice)
  return source
}
module.exports = adaptDownloadAction
