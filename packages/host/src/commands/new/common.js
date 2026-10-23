import { resolveNewNamedPackageOptions } from '../../new/prompt.js'
import { newPackage } from '../../new.js'
/** @import { Argv } from 'yargs' */

export const command = 'common [name]'
export const describe = 'Create common/<name>/'

/**
 * @param {Argv} yargs
 */
export function builder(yargs) {
  return yargs
    .positional('name', {
      type: 'string',
      describe: 'Common package name (prompted on TTY if omitted)',
    })
    .option('force', {
      alias: 'f',
      type: 'boolean',
      default: false,
      describe: 'Overwrite existing scaffold files',
    })
    .option('yes', {
      alias: 'y',
      type: 'boolean',
      default: false,
      describe: 'Non-interactive (name required on CLI)',
    })
}

/**
 * @typedef {object} NewCommonArgv
 * @property {string} [name]
 * @property {boolean} [force]
 * @property {boolean} [yes]
 */

/**
 * @param {NewCommonArgv} argv
 */
export async function handler(argv) {
  try {
    const opts = await resolveNewNamedPackageOptions(
      { name: argv.name, force: Boolean(argv.force), yes: Boolean(argv.yes) },
      { kind: 'common' },
    )
    const result = newPackage('common', opts.name, {
      force: opts.force,
    })
    console.log(`created ${result.path}`)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  }
}
