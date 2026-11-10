import './contracts'
import './shell.css'
document.documentElement.classList.add('lx-ztools-shell')
void window.lxHost.invoke('runtime:ready').then(async () => {
  await import('../../vendor/lx/src/renderer/main')
  await import('./player.js')
  await import('./download.js')
  await import('./catalog.js')
}).catch(error => {
  console.error('LX Music initialization failed', error)
  document.body.replaceChildren()
  const message = document.createElement('p')
  message.style.cssText = 'padding:24px;white-space:pre-wrap;font-family:system-ui'
  message.textContent = `LX Music 启动失败：${error.message || error}\n请检查插件文件完整性及 ZTools 版本后重新进入插件。`
  document.body.append(message)
})
