import { startHost } from './host-fixture.mjs'
import { expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
mkdirSync('artifacts/renderer', { recursive: true })
let host
try {
  host = await startHost('dist/lx.html')
  await expect.poll(() => host.evaluate('document.body.innerText'), { timeout: 20000 }).toMatch(/搜索/)
  // Test data only: close the original agreement modal to exercise the actual page.
  await host.evaluate(`lxHost.invoke('common_set_app_setting',{'common.isAgreePact':true,'common.showChangeLog':false})`)
  await expect.poll(() => host.evaluate(`document.body.innerText.includes('在使用本软件前')`)).toBe(false)
  await host.evaluate(`location.hash='/setting'`)
  let stable = 0
  await expect.poll(async () => {
    const visible = await host.evaluate(`location.hash==='#/setting' && !!document.querySelector('#basic')?.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})`)
    stable = visible ? stable + 1 : 0
    return stable
  }, { timeout: 15000, intervals: [200] }).toBeGreaterThanOrEqual(4)
  const screenshot = await host.app.evaluate(async ({ webContents }) => {
    const wc = webContents.getAllWebContents().find(x => x.getURL().includes('/dist/lx.html'))
    return (await wc.capturePage()).toPNG().toString('base64')
  })
  writeFileSync('artifacts/renderer/settings.png', Buffer.from(screenshot, 'base64'))
  writeFileSync('artifacts/renderer/report.json', JSON.stringify({ status: 'PASS', data: host.data, text: await host.evaluate('document.body.innerText'), logs: await host.logs() }, null, 2))
  console.log('PASS original LX renderer navigation and source settings')
} catch (error) { writeFileSync('artifacts/renderer/report.json', JSON.stringify({ status: 'FAIL', error: String(error.stack || error), logs: await host?.logs() }, null, 2)); throw error }
finally { await host?.close() }
