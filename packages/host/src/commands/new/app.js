import { newPackage } from '../../new.js'
/** @import { Argv } from 'yargs' */

export const command = 'app <name>'
export const describe = 'Create applications/<name>/'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('name', {
      type: 'string',
      describe: 'App name',
    })
    .option('force', {
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing schema/README',
    })
}

/**
 * @typedef {object} NewAppArgv
 * @property {string} name
 * @property {boolean} [force]
 */

/**
 * @param {NewAppArgv} argv
 */
export async function handler(argv) {
  try {
    const result = newPackage('app', String(argv.name), {
      force: Boolean(argv.force),
    })
    console.log(`created ${result.path}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
