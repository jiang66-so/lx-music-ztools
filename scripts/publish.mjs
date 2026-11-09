import { execFileSync } from 'node:child_process'
import { registerHooks } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

// 复用用户已经登录的 GitHub CLI，不把凭据写入项目或 CLI 配置。
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
process.env.ZTOOLS_CONFIG_DIR ||= join(homedir(), '.config', 'ztools', 'lx-music-ztools')
const cache = join(process.env.ZTOOLS_CONFIG_DIR, 'ZTools-plugins')
const write = process.stdout.write.bind(process.stdout)
const errorWrite = process.stderr.write.bind(process.stderr)
process.stdout.write = (chunk, ...args) => write(String(chunk).replaceAll(token, '[REDACTED]'), ...args)
process.stderr.write = (chunk, ...args) => errorWrite(String(chunk).replaceAll(token, '[REDACTED]'), ...args)
globalThis[Symbol.for('lx-publish-token')] = token
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './auth.js' && context.parentURL?.includes('/@ztools-center/plugin-cli/dist/')) return { url: 'lx-auth:gh', shortCircuit: true }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url === 'lx-auth:gh') return { format: 'module', shortCircuit: true, source: 'export async function ensureAuth(){ return globalThis[Symbol.for("lx-publish-token")] }' }
    return next(url, context)
  }
})
try {
  const { publish } = await import('@ztools-center/plugin-cli/dist/publish.js')
  await publish()
} finally {
  // 官方 CLI 会将认证 URL 写入缓存 remote；完成后移除其中的凭据。
  if (existsSync(join(cache, '.git'))) {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: cache, encoding: 'utf8' }).trim()
    const clean = url.replace(/https:\/\/[^/]*@github\.com\//, 'https://github.com/')
    execFileSync('git', ['remote', 'set-url', 'origin', clean], { cwd: cache, stdio: 'ignore' })
  }
  delete globalThis[Symbol.for('lx-publish-token')]
}
