import { newPackage } from '../../new.js'
/** @import { Argv } from 'yargs' */

export const command = 'network <name>'
export const describe = 'Create networks/<name>/'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('name', {
      type: 'string',
      describe: 'Network name',
    })
    .option('force', {
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing schema/README',
    })
}

/**
 * @typedef {object} NewNetworkArgv
 * @property {string} name
 * @property {boolean} [force]
 */

/**
 * @param {NewNetworkArgv} argv
 */
export async function handler(argv) {
  try {
    const result = newPackage('network', String(argv.name), {
      force: Boolean(argv.force),
    })
    console.log(`created ${result.path}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
