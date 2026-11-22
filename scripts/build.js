'use strict';

const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, 'src', 'renderer', 'app.js')],
    outfile: path.join(root, 'dist', 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['chrome120'],
    sourcemap: true,
    logLevel: 'info',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  });

  console.log('[clippulse] Renderer bundle written to dist/renderer.js');
}

main().catch((err) => {
  console.error('[clippulse] Build failed:', err);
  process.exit(1);
});
