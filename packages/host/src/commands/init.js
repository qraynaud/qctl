import { initInstance } from '../init.js'
/** @import { Argv } from 'yargs' */

export const command = 'init [dir]'
export const describe = 'Scaffold a new instance repo (mise.toml, schemas, provision/)'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('dir', {
      type: 'string',
      default: '.',
      describe: 'Target directory',
    })
    .option('force', {
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing scaffold files',
    })
}

/**
 * @typedef {object} InitCmdArgv
 * @property {string} [dir]
 * @property {boolean} [force]
 */

/**
 * @param {InitCmdArgv} argv
 */
export async function handler(argv) {
  try {
    const result = initInstance(String(argv.dir ?? '.'), {
      force: Boolean(argv.force),
    })
    console.log(`initialized ${result.root}`)
    for (const rel of result.written) console.log(`  + ${rel}`)
    for (const rel of result.skipped) console.log(`  = ${rel} (exists)`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
