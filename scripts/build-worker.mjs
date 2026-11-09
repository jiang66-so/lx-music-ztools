import { build } from 'esbuild'
await build({ entryPoints: ['src/source-worker.js'], bundle: true, platform: 'browser',
  outfile: 'src-ztools/dist/source-worker.js', format: 'iife', minify: false,
  alias: { stream: 'stream-browserify', events: 'events' }, define: { global: 'globalThis' },
  inject: ['src/worker-shims.js'],
  banner: { js: 'try {' }, footer: { js: '} catch(error) { postMessage({type:"error",error:String(error.stack || error)}) }' },
})
