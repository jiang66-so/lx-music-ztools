import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
const source = resolve('dist-webview')
const manifest = JSON.parse(readFileSync(join(source, 'plugin.json'), 'utf8'))
if (Object.hasOwn(manifest, 'preload') || manifest.name !== 'lx-music-ztools-webview') throw new Error('拒绝打包错误的 WebView manifest')
const roots = ['dist', 'plugin.json', 'logo.png', 'LICENSE', 'NOTICE', 'THIRD-PARTY-NOTICES.txt']
const files = []
function visit(path) { for (const item of readdirSync(join(source, path), { withFileTypes: true })) { const relative = path + '/' + item.name; if (item.isSymbolicLink()) throw new Error('拒绝打包链接'); if (item.isDirectory()) visit(relative); else files.push(relative) } }
visit('dist')
files.push(...roots.slice(1))
if (files.some(file => /(?:^|\/)(?:preload|node_modules|artifacts|upstream)\//.test(file))) throw new Error('发现非浏览器产物')
mkdirSync('dist-webview-packages', { recursive: true })
const output = resolve('dist-webview-packages', `${manifest.name}-${manifest.version}.zip`)
// Only the explicit build-output list is packaged. Browser data/private sources are never inputs.
const command = `Add-Type -AssemblyName System.IO.Compression
$stream = [IO.File]::Open($env:LX_WEBVIEW_OUTPUT, [IO.FileMode]::Create)
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
  $names = ConvertFrom-Json $env:LX_WEBVIEW_FILES
  foreach ($name in $names) {
    $entry = $zip.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = [DateTimeOffset]::Parse('2000-01-01T00:00:00Z')
    $inputStream = [IO.File]::OpenRead([IO.Path]::Combine($env:LX_WEBVIEW_SOURCE, $name))
    $entryStream = $entry.Open()
    try { $inputStream.CopyTo($entryStream) } finally { $inputStream.Dispose(); $entryStream.Dispose() }
  }
} finally { $zip.Dispose(); $stream.Dispose() }`
execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { env: { ...process.env, LX_WEBVIEW_SOURCE: source, LX_WEBVIEW_OUTPUT: output, LX_WEBVIEW_FILES: JSON.stringify(files.sort()) }, stdio: 'inherit' })
const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex')
writeFileSync(output + '.sha256', `${sha256}  ${manifest.name}-${manifest.version}.zip\n`)
console.log(JSON.stringify({ output, files: files.length, sha256 }, null, 2))
