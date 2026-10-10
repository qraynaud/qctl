#!/usr/bin/env -S bunx zx
/**
 * Root lint entry used by `bun run test:lint`.
 * `bun run test:lint -- --fix` forwards `--fix` to Biome and the JSDoc checker.
 */
import { join } from 'node:path'

import { ROOT } from './common/root.js'
import { createToolingYargsFromMeta, withFixOption } from './common/yargs-cli.js'

$.verbose = false
cd(ROOT)

const argv = withFixOption(
  createToolingYargsFromMeta(import.meta.url, 'tooling/lint.js', {
    unknownOptionsAsArgs: true,
  })
    .usage('$0 [--fix] [biome check args...]')
    .epilogue('Runs tooling/check-jsdoc.js then `biome check .` with any extra args.'),
  'Forward --fix to the JSDoc checker and to Biome',
).parseSync()

/** @type {string[]} */
const biomeArgs = []
if (argv.fix) biomeArgs.push('--fix')
biomeArgs.push(...argv._.map(String))

const checkJsdoc = join(ROOT, 'tooling/check-jsdoc.js')
const jsdocArgs = argv.fix ? ['--fix'] : []

const jsdoc = await $({
  stdio: 'inherit',
  nothrow: true,
})`bunx zx ${checkJsdoc} ${jsdocArgs}`

const biome = await $({
  stdio: 'inherit',
  nothrow: true,
})`bunx biome check . --error-on-warnings ${biomeArgs}`

process.exit(jsdoc.exitCode || biome.exitCode)
