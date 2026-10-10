#!/usr/bin/env bun
/**
 * Bundle the varlock plugin into a single self-contained CJS file.
 * Output: dist/vaultwarden.cjs  (npm exports["./plugin"]; self-contained for varlock download)
 *
 * `varlock/plugin-lib` stays external — varlock provides it at load time.
 */
const { join } = require('node:path')

const root = __dirname
const outfile = join(root, 'dist', 'vaultwarden.cjs')

;(async () => {
  const result = await Bun.build({
    entrypoints: [join(root, 'src', 'plugin.js')],
    outdir: join(root, 'dist'),
    naming: 'vaultwarden.cjs',
    target: 'node',
    format: 'cjs',
    external: ['varlock', 'varlock/plugin-lib'],
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
  console.log(`built ${outfile}`)
})()
