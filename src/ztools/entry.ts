import './contracts'
void window.lxHost.invoke('runtime:ready').then(async () => {
  await import('../../vendor/lx/src/renderer/main')
  await import('./player.js')
})
