const PREFIX = 'lx-music:framework:'
const probes = require('./probes.cjs')
const { randomUUID } = require('node:crypto')
let lifecycleProbe
window.services = {
  startLifecycleProbe() {
    if (!lifecycleProbe) {
      lifecycleProbe = { id: randomUUID(), ticks: 0 }
      setInterval(() => lifecycleProbe.ticks++, 100)
    }
    return { ...lifecycleProbe }
  },
  getLifecycleProbe() { return { ...lifecycleProbe } },
  probeCapabilities() { return probes.probeCapabilities(window.ztools) },
  probeSourceIsolation() { return probes.probeSourceIsolation() },
  probeWorkerIsolation(publicKey) { return probes.probeWorkerIsolation(publicKey) },
  /** 返回当前宿主与 Node 运行环境。 */
  diagnose() { return { app: window.ztools.getAppName(), version: window.ztools.getAppVersion(), node: process.versions.node } },
  /** 读取插件进入计数。 */
  getLaunchCount() { return Number(window.ztools.dbStorage.getItem(PREFIX + 'launches')) || 0 },
  /** 记录进入事件并返回累计次数。 */
  recordLaunch() {
    const next = this.getLaunchCount() + 1
    window.ztools.dbStorage.setItem(PREFIX + 'launches', next)
    return next
  },
  /** 验证插件存储写入与回读，随后清理临时键。 */
  checkStorage() {
    const key = PREFIX + 'probe'
    const value = require('node:crypto').randomUUID()
    try { window.ztools.dbStorage.setItem(key, value); return window.ztools.dbStorage.getItem(key) === value }
    finally { window.ztools.dbStorage.removeItem(key) }
  }
}
