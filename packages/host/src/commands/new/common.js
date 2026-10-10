import { newPackage } from '../../new.js'
/** @import { Argv } from 'yargs' */

export const command = 'common <name>'
export const describe = 'Create common/<name>/'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('name', {
      type: 'string',
      describe: 'Common package name',
    })
    .option('force', {
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing schema/README',
    })
}

/**
 * @typedef {object} NewCommonArgv
 * @property {string} name
 * @property {boolean} [force]
 */

/**
 * @param {NewCommonArgv} argv
 */
export async function handler(argv) {
  try {
    const result = newPackage('common', String(argv.name), {
      force: Boolean(argv.force),
    })
    console.log(`created ${result.path}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
