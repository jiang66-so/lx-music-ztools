import './contracts'
void window.lxHost.invoke('runtime:ready').then(() => import('../../vendor/lx/src/renderer/main'))
